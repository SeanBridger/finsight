"""Request metrics logging and aggregation.

Logs per-request metrics (latency, tokens, cost, tools, guardrail status)
to DynamoDB. Serves aggregated stats for the observability dashboard.
"""

import logging
import os
import time
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

logger = logging.getLogger(__name__)

AWS_REGION = os.environ.get("AWS_DEFAULT_REGION", os.environ.get("AWS_REGION", "us-east-1"))
METRICS_TABLE = os.environ.get("METRICS_TABLE", "finsight-metrics")

# Claude Sonnet 4.6 pricing (per token, not per million)
INPUT_COST_PER_TOKEN = Decimal("0.000003")  # $3 / 1M
OUTPUT_COST_PER_TOKEN = Decimal("0.000015")  # $15 / 1M

_table = None


def _get_table():
    global _table
    if _table is None:
        dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
        _table = dynamodb.Table(METRICS_TABLE)
    return _table


def _to_decimal(value: Any) -> Any:
    """Convert floats to Decimal for DynamoDB compatibility."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: _to_decimal(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_decimal(v) for v in value]
    return value


def log_request(
    question: str,
    latency_ms: int,
    input_tokens: int,
    output_tokens: int,
    tool_calls: list[dict],
    iterations: int,
    guardrail_blocked: bool = False,
    error: str | None = None,
) -> None:
    """Log a single request's metrics to DynamoDB."""
    now = datetime.now(UTC)
    input_cost = INPUT_COST_PER_TOKEN * input_tokens
    output_cost = OUTPUT_COST_PER_TOKEN * output_tokens
    total_cost = input_cost + output_cost

    # Tools used in this request
    tools_used = list({tc.get("tool", "unknown") for tc in tool_calls})

    item = {
        "requestId": str(uuid.uuid4()),
        "timestamp": now.isoformat(),
        "date": now.strftime("%Y-%m-%d"),
        "question": question[:200],  # Truncate for storage
        "latencyMs": latency_ms,
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "totalTokens": input_tokens + output_tokens,
        "inputCost": input_cost,
        "outputCost": output_cost,
        "totalCost": total_cost,
        "toolCalls": _to_decimal(tool_calls) if tool_calls else [],
        "toolsUsed": tools_used,
        "toolCallCount": len(tool_calls),
        "iterations": iterations,
        "guardrailBlocked": guardrail_blocked,
    }

    if error:
        item["error"] = error[:500]

    try:
        _get_table().put_item(Item=item)
    except Exception:
        logger.exception("Failed to log metrics")


def get_metrics(days: int = 7, limit: int = 200) -> dict:
    """Get aggregated metrics for the dashboard.

    Returns recent requests plus computed aggregates.
    """
    from datetime import timedelta

    cutoff = (datetime.now(UTC) - timedelta(days=days)).strftime("%Y-%m-%d")

    # Scan recent items (fine for portfolio scale)
    try:
        response = _get_table().scan(
            FilterExpression=Key("date").gte(cutoff),
            Limit=limit,
        )
        items = response.get("Items", [])
    except Exception:
        logger.exception("Failed to fetch metrics")
        return {"requests": [], "aggregates": {}}

    if not items:
        return {"requests": [], "aggregates": {}}

    # Sort by timestamp descending
    items.sort(key=lambda x: x.get("timestamp", ""), reverse=True)

    # Compute aggregates
    latencies = [int(i["latencyMs"]) for i in items if "latencyMs" in i]
    costs = [float(i["totalCost"]) for i in items if "totalCost" in i]
    input_tokens = [int(i["inputTokens"]) for i in items if "inputTokens" in i]
    output_tokens = [int(i["outputTokens"]) for i in items if "outputTokens" in i]
    tool_counts = [int(i["toolCallCount"]) for i in items if "toolCallCount" in i]

    # Tool usage frequency
    tool_freq: dict[str, int] = {}
    for item in items:
        for tool in item.get("toolsUsed", []):
            tool_freq[tool] = tool_freq.get(tool, 0) + 1

    # Guardrail stats
    total_requests = len(items)
    blocked = sum(1 for i in items if i.get("guardrailBlocked"))
    errors = sum(1 for i in items if i.get("error"))

    def _percentile(sorted_vals: list, p: float) -> float:
        if not sorted_vals:
            return 0
        k = (len(sorted_vals) - 1) * p
        f = int(k)
        c = f + 1
        if c >= len(sorted_vals):
            return float(sorted_vals[f])
        return float(sorted_vals[f]) + (k - f) * (float(sorted_vals[c]) - float(sorted_vals[f]))

    sorted_latencies = sorted(latencies)

    aggregates = {
        "totalRequests": total_requests,
        "blockedRequests": blocked,
        "errorRequests": errors,
        "latency": {
            "p50": _percentile(sorted_latencies, 0.5),
            "p95": _percentile(sorted_latencies, 0.95),
            "p99": _percentile(sorted_latencies, 0.99),
            "avg": sum(latencies) / len(latencies) if latencies else 0,
        },
        "cost": {
            "total": sum(costs),
            "avg": sum(costs) / len(costs) if costs else 0,
            "max": max(costs) if costs else 0,
        },
        "tokens": {
            "totalInput": sum(input_tokens),
            "totalOutput": sum(output_tokens),
            "avgInput": sum(input_tokens) // len(input_tokens) if input_tokens else 0,
            "avgOutput": sum(output_tokens) // len(output_tokens) if output_tokens else 0,
        },
        "tools": {
            "avgCallsPerRequest": (sum(tool_counts) / len(tool_counts) if tool_counts else 0),
            "frequency": tool_freq,
        },
    }

    # Convert Decimals to floats for JSON serialisation
    serialisable_items = []
    for item in items[:50]:  # Return last 50 for the chart
        serialisable_items.append(
            {
                "timestamp": item.get("timestamp"),
                "question": item.get("question"),
                "latencyMs": int(item.get("latencyMs", 0)),
                "inputTokens": int(item.get("inputTokens", 0)),
                "outputTokens": int(item.get("outputTokens", 0)),
                "totalCost": float(item.get("totalCost", 0)),
                "toolCallCount": int(item.get("toolCallCount", 0)),
                "toolsUsed": item.get("toolsUsed", []),
                "iterations": int(item.get("iterations", 0)),
                "guardrailBlocked": item.get("guardrailBlocked", False),
                "error": item.get("error"),
            }
        )

    return {
        "requests": serialisable_items,
        "aggregates": aggregates,
    }


class RequestTimer:
    """Context manager to time a request and log metrics."""

    def __init__(self, question: str):
        self.question = question
        self.start_time = 0.0
        self.input_tokens = 0
        self.output_tokens = 0
        self.tool_calls: list[dict] = []
        self.iterations = 0
        self.guardrail_blocked = False
        self.error: str | None = None

    def __enter__(self):
        self.start_time = time.time()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        elapsed_ms = int((time.time() - self.start_time) * 1000)
        if exc_type:
            self.error = str(exc_val)[:500]

        log_request(
            question=self.question,
            latency_ms=elapsed_ms,
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
            tool_calls=self.tool_calls,
            iterations=self.iterations,
            guardrail_blocked=self.guardrail_blocked,
            error=self.error,
        )
        return False  # Don't suppress exceptions

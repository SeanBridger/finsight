"""Evaluation results storage in DynamoDB.

Saves eval run summaries and per-question results to the metrics
table (reuses the same table with a different key prefix).
"""

import logging
import os
from datetime import UTC, datetime
from decimal import Decimal

import boto3

logger = logging.getLogger(__name__)

AWS_REGION = os.environ.get(
    "AWS_DEFAULT_REGION",
    os.environ.get("AWS_REGION", "us-east-1"),
)
METRICS_TABLE = os.environ.get("METRICS_TABLE", "finsight-metrics")

_table = None


def _get_table():
    global _table
    if _table is None:
        dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
        _table = dynamodb.Table(METRICS_TABLE)
    return _table


def _to_decimal(obj):
    """Convert floats to Decimal for DynamoDB."""
    if isinstance(obj, float):
        return Decimal(str(round(obj, 4)))
    if isinstance(obj, dict):
        return {k: _to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_decimal(v) for v in obj]
    return obj


def save_eval_run(summary: dict) -> str:
    """Save an evaluation run summary to DynamoDB.

    Returns the eval run ID.
    """
    timestamp = summary.get(
        "timestamp",
        datetime.now(UTC).isoformat(),
    )
    eval_id = f"eval_{timestamp.replace(':', '-').replace('.', '-')}"

    item = {
        "requestId": eval_id,
        "timestamp": timestamp,
        "date": timestamp[:10],
        "evalRun": True,
        "datasetSize": summary["dataset_size"],
        "avgRelevance": _to_decimal(summary["avg_relevance"]),
        "avgFaithfulness": _to_decimal(summary["avg_faithfulness"]),
        "categoryScores": _to_decimal(summary.get("category_scores", {})),
        "results": _to_decimal(summary.get("results", [])),
    }

    try:
        _get_table().put_item(Item=item)
        logger.info("Saved eval run %s", eval_id)
    except Exception:
        logger.exception("Failed to save eval run")

    return eval_id


def get_latest_eval() -> dict | None:
    """Get the most recent evaluation run from DynamoDB."""
    try:
        response = _get_table().scan(
            FilterExpression="attribute_exists(evalRun)",
            Limit=50,
        )
        items = response.get("Items", [])

        if not items:
            return None

        # Sort by timestamp descending, pick latest
        items.sort(
            key=lambda x: x.get("timestamp", ""),
            reverse=True,
        )
        latest = items[0]

        # Convert Decimals to floats for JSON
        return {
            "eval_id": latest.get("requestId"),
            "timestamp": latest.get("timestamp"),
            "dataset_size": int(latest.get("datasetSize", 0)),
            "avg_relevance": float(latest.get("avgRelevance", 0)),
            "avg_faithfulness": float(latest.get("avgFaithfulness", 0)),
            "category_scores": _decimal_to_float(
                latest.get("categoryScores", {}),
            ),
            "results": _decimal_to_float(latest.get("results", [])),
        }

    except Exception:
        logger.exception("Failed to fetch eval results")
        return None


def get_eval_history(limit: int = 10) -> list[dict]:
    """Get recent evaluation run summaries (without per-question detail)."""
    try:
        response = _get_table().scan(
            FilterExpression="attribute_exists(evalRun)",
            Limit=50,
        )
        items = response.get("Items", [])

        if not items:
            return []

        items.sort(
            key=lambda x: x.get("timestamp", ""),
            reverse=True,
        )

        return [
            {
                "eval_id": item.get("requestId"),
                "timestamp": item.get("timestamp"),
                "dataset_size": int(item.get("datasetSize", 0)),
                "avg_relevance": float(item.get("avgRelevance", 0)),
                "avg_faithfulness": float(
                    item.get("avgFaithfulness", 0),
                ),
            }
            for item in items[:limit]
        ]

    except Exception:
        logger.exception("Failed to fetch eval history")
        return []


def _decimal_to_float(obj):
    """Convert Decimals back to floats for JSON serialisation."""
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, dict):
        return {k: _decimal_to_float(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_decimal_to_float(v) for v in obj]
    return obj

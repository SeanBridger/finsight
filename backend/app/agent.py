"""Non-streaming agentic research loop using Bedrock Converse tool use.

Claude receives the analyst's question and a set of tool definitions.
It decides which tools to call, we execute them, send results back,
and repeat until Claude produces a final answer.
"""

import json
import logging

from app.agent_helpers import (
    MAX_ITERATIONS,
    _build_messages,
    _collect_citations,
    _converse_with_tools,
    _extract_text,
)
from app.guardrail_api import apply_guardrail
from app.guardrails import validate_input
from app.metrics import RequestTimer
from app.tools import execute_tool

logger = logging.getLogger(__name__)


def _process_tool_calls(
    assistant_message: dict,
) -> tuple[list[dict], list[dict]]:
    tool_results = []
    tool_trace = []

    for block in assistant_message.get("content", []):
        if "toolUse" not in block:
            continue

        tool_use = block["toolUse"]
        tool_name = tool_use["name"]
        tool_input = tool_use.get("input", {})

        logger.info(
            "Tool call: %s(%s)",
            tool_name,
            json.dumps(tool_input, default=str)[:200],
        )

        result = execute_tool(tool_name, tool_input)

        results_key = result.get("results", result.get("documents", []))
        tool_trace.append(
            {
                "tool": tool_name,
                "input": tool_input,
                "result_summary": f"{len(results_key)} results",
            }
        )

        is_error = "error" in result
        tool_results.append(
            {
                "toolResult": {
                    "toolUseId": tool_use["toolUseId"],
                    "content": [{"json": result}],
                    "status": "error" if is_error else "success",
                }
            }
        )

    return tool_results, tool_trace


def agent_research(
    question: str,
    history: list[dict] | None = None,
) -> dict:
    with RequestTimer(question) as timer:
        is_valid, rejection = validate_input(question)
        if not is_valid:
            timer.guardrail_blocked = True
            return {
                "answer": rejection,
                "tool_calls": [],
                "citations": [],
                "is_grounded": False,
                "iterations": 0,
                "token_usage": {"input": 0, "output": 0},
                "guardrail_blocked": True,
            }

        guardrail_result = apply_guardrail(question, "INPUT")
        if guardrail_result.get("blocked"):
            timer.guardrail_blocked = True
            return {
                "answer": guardrail_result.get(
                    "blocked_response",
                    "Blocked by guardrails.",
                ),
                "tool_calls": [],
                "citations": [],
                "is_grounded": False,
                "iterations": 0,
                "token_usage": {"input": 0, "output": 0},
                "guardrail_blocked": True,
            }

        messages = _build_messages(question, history or [])
        all_tool_calls = []
        all_citations = []
        total_input = 0
        total_output = 0

        for iteration in range(MAX_ITERATIONS):
            logger.info("Agent iteration %d", iteration + 1)
            response = _converse_with_tools(messages)

            usage = response.get("usage", {})
            total_input += usage.get("inputTokens", 0)
            total_output += usage.get("outputTokens", 0)

            stop_reason = response["stopReason"]
            assistant_message = response["output"]["message"]
            messages.append(assistant_message)

            if stop_reason == "end_turn":
                timer.input_tokens = total_input
                timer.output_tokens = total_output
                timer.tool_calls = all_tool_calls
                timer.iterations = iteration + 1
                return {
                    "answer": _extract_text(assistant_message),
                    "tool_calls": all_tool_calls,
                    "citations": all_citations,
                    "is_grounded": bool(all_citations),
                    "iterations": iteration + 1,
                    "token_usage": {
                        "input": total_input,
                        "output": total_output,
                    },
                }

            if stop_reason == "tool_use":
                tool_results, tool_trace = _process_tool_calls(assistant_message)
                for tr in tool_results:
                    data = tr["toolResult"]["content"][0]["json"]
                    all_citations = _collect_citations(data, all_citations)
                for t in tool_trace:
                    t["iteration"] = iteration + 1
                all_tool_calls.extend(tool_trace)
                messages.append({"role": "user", "content": tool_results})
                continue

            logger.warning("Unexpected stopReason: %s", stop_reason)
            break

        timer.input_tokens = total_input
        timer.output_tokens = total_output
        timer.tool_calls = all_tool_calls
        timer.iterations = MAX_ITERATIONS
        fallback = (
            "I ran out of steps before completing the research. Try a more specific question."
        )
        return {
            "answer": fallback,
            "tool_calls": all_tool_calls,
            "citations": all_citations,
            "is_grounded": bool(all_citations),
            "iterations": MAX_ITERATIONS,
            "token_usage": {
                "input": total_input,
                "output": total_output,
            },
        }

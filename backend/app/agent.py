"""Agentic research loop using Bedrock Converse tool use.

Claude receives the analyst's question and a set of tool definitions.
It decides which tools to call, we execute them, send results back,
and repeat until Claude produces a final answer.
"""

import json
import logging
import os
import time

import boto3

from app.bedrock import ANALYST_PERSONA, RAGConfig
from app.guardrail_test import test_guardrail
from app.guardrails import validate_input
from app.tools import TOOL_SPECS, execute_tool

logger = logging.getLogger(__name__)
AWS_REGION = os.environ.get("AWS_DEFAULT_REGION", os.environ.get("AWS_REGION", "us-east-1"))

config = RAGConfig()
bedrock = boto3.client("bedrock-runtime", region_name=AWS_REGION)

MAX_ITERATIONS = 15

_CONVERSE_PARAMS = {
    "system": [{"text": ANALYST_PERSONA}],
    "toolConfig": {"tools": TOOL_SPECS},
    "inferenceConfig": {"maxTokens": 4096, "temperature": 0.1},
}


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


def _converse_with_tools(messages: list[dict]) -> dict:
    return bedrock.converse(
        modelId=config.chat_model,
        messages=messages,
        **_CONVERSE_PARAMS,
    )


def _converse_stream(messages: list[dict]) -> dict:
    return bedrock.converse_stream(
        modelId=config.chat_model,
        messages=messages,
        **_CONVERSE_PARAMS,
    )


def _extract_text(message: dict) -> str:
    return "\n\n".join(block["text"] for block in message.get("content", []) if "text" in block)


def _build_messages(
    question: str,
    history: list[dict],
) -> list[dict]:
    messages = []
    for h in history:
        role = h.get("role", "user")
        content = h.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append(
                {
                    "role": role,
                    "content": [{"text": content}],
                }
            )
    messages.append(
        {
            "role": "user",
            "content": [{"text": question}],
        }
    )
    return messages


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

        results_key = result.get(
            "results",
            result.get("documents", []),
        )
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


def _collect_citations(
    result: dict,
    existing: list[dict],
) -> list[dict]:
    seen = {c["source"] for c in existing}
    new_citations = list(existing)
    for r in result.get("results", []):
        source = r.get("source", "unknown")
        if source not in seen:
            seen.add(source)
            new_citations.append(
                {
                    "source": source,
                    "relevance_score": r.get("relevance_score", 0),
                    "text": r.get("text", "")[:500],
                }
            )
    return new_citations


def _consume_converse_stream(messages: list[dict]):
    """Consume one Bedrock ConverseStream turn.

    Yields SSE events for text deltas as they arrive. A small sleep
    after each delta forces the ASGI threadpool to flush each chunk
    individually rather than batching rapid yields.
    """
    stream_response = _converse_stream(messages)

    content_blocks: dict[int, dict] = {}
    stop_reason = None
    usage = {}

    for event in stream_response["stream"]:
        if "messageStart" in event:
            continue

        if "contentBlockStart" in event:
            start_event = event["contentBlockStart"]
            block_index = start_event["contentBlockIndex"]
            start = start_event.get("start", {})

            if "toolUse" in start:
                tool_use = start["toolUse"]
                content_blocks[block_index] = {
                    "toolUse": {
                        "toolUseId": tool_use["toolUseId"],
                        "name": tool_use["name"],
                        "_input_json": "",
                    }
                }
            else:
                content_blocks[block_index] = {"text": ""}
            continue

        if "contentBlockDelta" in event:
            delta_event = event["contentBlockDelta"]
            block_index = delta_event["contentBlockIndex"]
            delta = delta_event.get("delta", {})
            block = content_blocks.setdefault(
                block_index,
                {"text": ""},
            )

            if "text" in delta:
                text = delta["text"]
                block["text"] = block.get("text", "") + text
                yield _sse({"type": "delta", "text": text})
                time.sleep(0.01)

            elif "toolUse" in delta:
                tool_delta = delta["toolUse"]
                input_fragment = tool_delta.get("input", "")
                block.setdefault(
                    "toolUse",
                    {
                        "toolUseId": "",
                        "name": "",
                        "_input_json": "",
                    },
                )
                block["toolUse"]["_input_json"] += input_fragment
            continue

        if "contentBlockStop" in event:
            continue

        if "messageStop" in event:
            stop_reason = event["messageStop"].get(
                "stopReason",
            )
            continue

        if "metadata" in event:
            usage = event["metadata"].get("usage", {})
            continue

    assistant_message = {"role": "assistant", "content": []}
    for block_index in sorted(content_blocks):
        block = content_blocks[block_index]

        if "toolUse" in block:
            tool_use = block["toolUse"]
            raw_input = tool_use.pop("_input_json", "")
            try:
                parsed_input = json.loads(raw_input or "{}")
            except json.JSONDecodeError:
                logger.warning(
                    "Failed to parse tool input: %s",
                    raw_input,
                )
                parsed_input = {}
            tool_use["input"] = parsed_input
            assistant_message["content"].append(
                {"toolUse": tool_use},
            )
        elif "text" in block:
            assistant_message["content"].append(
                {"text": block.get("text", "")},
            )

    yield _sse(
        {
            "type": "_bedrock_turn_complete",
            "stop_reason": stop_reason,
            "assistant_message": assistant_message,
            "usage": usage,
        }
    )


def agent_research(
    question: str,
    history: list[dict] | None = None,
) -> dict:
    is_valid, rejection = validate_input(question)
    if not is_valid:
        return {
            "answer": rejection,
            "tool_calls": [],
            "citations": [],
            "is_grounded": False,
            "iterations": 0,
            "token_usage": {"input": 0, "output": 0},
            "guardrail_blocked": True,
        }

    guardrail_result = test_guardrail(question, "INPUT")
    if guardrail_result.get("blocked"):
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
            tool_results, tool_trace = _process_tool_calls(
                assistant_message,
            )
            for tr in tool_results:
                data = tr["toolResult"]["content"][0]["json"]
                all_citations = _collect_citations(
                    data,
                    all_citations,
                )
            for t in tool_trace:
                t["iteration"] = iteration + 1
            all_tool_calls.extend(tool_trace)
            messages.append(
                {
                    "role": "user",
                    "content": tool_results,
                }
            )
            continue

        logger.warning(
            "Unexpected stopReason: %s",
            stop_reason,
        )
        break

    fallback = "I ran out of steps before completing the research. Try a more specific question."
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


def agent_research_stream(
    question: str,
    history: list[dict] | None = None,
):
    is_valid, rejection = validate_input(question)
    if not is_valid:
        yield _sse({"type": "guardrail_blocked", "message": rejection})
        yield _sse(
            {
                "type": "done",
                "tool_calls": [],
                "iterations": 0,
                "token_usage": {"input": 0, "output": 0},
                "guardrail_blocked": True,
            }
        )
        return

    guardrail_result = test_guardrail(question, "INPUT")
    if guardrail_result.get("blocked"):
        message = guardrail_result.get(
            "blocked_response",
            "This request was blocked by our safety guardrails.",
        )
        yield _sse({"type": "guardrail_blocked", "message": message})
        yield _sse(
            {
                "type": "done",
                "tool_calls": [],
                "iterations": 0,
                "token_usage": {"input": 0, "output": 0},
                "guardrail_blocked": True,
            }
        )
        return

    messages = _build_messages(question, history or [])
    all_tool_calls = []
    all_citations = []
    total_input = 0
    total_output = 0

    for iteration in range(MAX_ITERATIONS):
        logger.info("Agent stream iteration %d", iteration + 1)

        turn_result = None
        turn_deltas = []

        try:
            for sse_chunk in _consume_converse_stream(messages):
                payload = sse_chunk.removeprefix("data: ").strip()
                try:
                    event = json.loads(payload)
                except json.JSONDecodeError:
                    continue

                if event.get("type") == "_bedrock_turn_complete":
                    turn_result = event
                elif event.get("type") == "delta":
                    turn_deltas.append(sse_chunk)
                else:
                    yield sse_chunk

        except Exception:
            logger.exception("Bedrock streaming failed")
            yield _sse(
                {
                    "type": "error",
                    "message": "Failed to get response from Bedrock.",
                }
            )
            return

        if not turn_result:
            yield _sse(
                {
                    "type": "error",
                    "message": "Stream ended without completion.",
                }
            )
            return

        usage = turn_result.get("usage", {})
        total_input += usage.get("inputTokens", 0)
        total_output += usage.get("outputTokens", 0)

        stop_reason = turn_result.get("stop_reason")
        assistant_message = turn_result["assistant_message"]
        messages.append(assistant_message)

        if stop_reason == "end_turn":
            for chunk in turn_deltas:
                yield chunk
                time.sleep(0.01)
            yield _sse(
                {
                    "type": "citations",
                    "citations": all_citations,
                    "is_grounded": bool(all_citations),
                }
            )
            yield _sse(
                {
                    "type": "done",
                    "tool_calls": all_tool_calls,
                    "iterations": iteration + 1,
                    "token_usage": {
                        "input": total_input,
                        "output": total_output,
                    },
                }
            )
            return

        if stop_reason == "tool_use":
            tool_results = []
            tool_trace = []

            for block in assistant_message.get("content", []):
                if "toolUse" not in block:
                    continue

                tool_use = block["toolUse"]
                tool_name = tool_use["name"]
                tool_input = tool_use.get("input", {})

                yield _sse(
                    {
                        "type": "tool_call",
                        "tool": tool_name,
                        "input": tool_input,
                        "iteration": iteration + 1,
                    }
                )

                result = execute_tool(tool_name, tool_input)

                all_citations = _collect_citations(
                    result,
                    all_citations,
                )

                results_key = result.get(
                    "results",
                    result.get("documents", []),
                )
                trace_entry = {
                    "tool": tool_name,
                    "input": tool_input,
                    "result_summary": (f"{len(results_key)} results"),
                    "iteration": iteration + 1,
                }
                tool_trace.append(trace_entry)

                yield _sse(
                    {
                        "type": "tool_result",
                        "tool": tool_name,
                        "summary": trace_entry["result_summary"],
                    }
                )

                is_error = "error" in result
                tool_results.append(
                    {
                        "toolResult": {
                            "toolUseId": tool_use["toolUseId"],
                            "content": [{"json": result}],
                            "status": ("error" if is_error else "success"),
                        }
                    }
                )

            all_tool_calls.extend(tool_trace)
            messages.append(
                {
                    "role": "user",
                    "content": tool_results,
                }
            )
            continue

        yield _sse(
            {
                "type": "error",
                "message": f"Unexpected stop: {stop_reason}",
            }
        )
        return

    yield _sse(
        {
            "type": "error",
            "message": "Agent reached maximum iterations",
        }
    )

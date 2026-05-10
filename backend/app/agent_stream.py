"""Streaming agentic research loop using Bedrock ConverseStream."""

import json
import logging
import time

from app.agent_helpers import (
    MAX_ITERATIONS,
    _build_messages,
    _collect_citations,
    _converse_stream,
    _sse,
)
from app.guardrail_api import apply_guardrail
from app.guardrails import validate_input
from app.metrics import log_request
from app.tools import execute_tool

logger = logging.getLogger(__name__)


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
            stop_reason = event["messageStop"].get("stopReason")
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
                logger.warning("Failed to parse tool input: %s", raw_input)
                parsed_input = {}
            tool_use["input"] = parsed_input
            assistant_message["content"].append({"toolUse": tool_use})
        elif "text" in block:
            assistant_message["content"].append({"text": block.get("text", "")})

    yield _sse(
        {
            "type": "_bedrock_turn_complete",
            "stop_reason": stop_reason,
            "assistant_message": assistant_message,
            "usage": usage,
        }
    )


def agent_research_stream(
    question: str,
    history: list[dict] | None = None,
):
    is_valid, rejection = validate_input(question)
    if not is_valid:
        log_request(
            question=question,
            latency_ms=0,
            input_tokens=0,
            output_tokens=0,
            tool_calls=[],
            iterations=0,
            guardrail_blocked=True,
        )
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

    guardrail_result = apply_guardrail(question, "INPUT")
    if guardrail_result.get("blocked"):
        message = guardrail_result.get(
            "blocked_response",
            "This request was blocked by our safety guardrails.",
        )
        log_request(
            question=question,
            latency_ms=0,
            input_tokens=0,
            output_tokens=0,
            tool_calls=[],
            iterations=0,
            guardrail_blocked=True,
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

    start_time = time.time()
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
            elapsed_ms = int((time.time() - start_time) * 1000)
            log_request(
                question=question,
                latency_ms=elapsed_ms,
                input_tokens=total_input,
                output_tokens=total_output,
                tool_calls=all_tool_calls,
                iterations=iteration + 1,
                error="Bedrock streaming failed",
            )
            yield _sse({"type": "error", "message": "Failed to get response from Bedrock."})
            return

        if not turn_result:
            elapsed_ms = int((time.time() - start_time) * 1000)
            log_request(
                question=question,
                latency_ms=elapsed_ms,
                input_tokens=total_input,
                output_tokens=total_output,
                tool_calls=all_tool_calls,
                iterations=iteration + 1,
                error="Stream ended without completion",
            )
            yield _sse({"type": "error", "message": "Stream ended without completion."})
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
            elapsed_ms = int((time.time() - start_time) * 1000)
            log_request(
                question=question,
                latency_ms=elapsed_ms,
                input_tokens=total_input,
                output_tokens=total_output,
                tool_calls=all_tool_calls,
                iterations=iteration + 1,
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
                all_citations = _collect_citations(result, all_citations)

                results_key = result.get("results", result.get("documents", []))
                trace_entry = {
                    "tool": tool_name,
                    "input": tool_input,
                    "result_summary": f"{len(results_key)} results",
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
                            "status": "error" if is_error else "success",
                        }
                    }
                )

            all_tool_calls.extend(tool_trace)
            messages.append({"role": "user", "content": tool_results})
            continue

        elapsed_ms = int((time.time() - start_time) * 1000)
        log_request(
            question=question,
            latency_ms=elapsed_ms,
            input_tokens=total_input,
            output_tokens=total_output,
            tool_calls=all_tool_calls,
            iterations=iteration + 1,
            error=f"Unexpected stop: {stop_reason}",
        )
        yield _sse({"type": "error", "message": f"Unexpected stop: {stop_reason}"})
        return

    elapsed_ms = int((time.time() - start_time) * 1000)
    log_request(
        question=question,
        latency_ms=elapsed_ms,
        input_tokens=total_input,
        output_tokens=total_output,
        tool_calls=all_tool_calls,
        iterations=MAX_ITERATIONS,
        error="Agent reached maximum iterations",
    )
    yield _sse({"type": "error", "message": "Agent reached maximum iterations"})

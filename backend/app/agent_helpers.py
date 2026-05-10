"""Shared utilities for the FinSight agentic research loops."""

import json
import os

import boto3

from app.bedrock import ANALYST_PERSONA, RAGConfig
from app.tools import TOOL_SPECS

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

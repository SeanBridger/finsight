import json
import logging
from dataclasses import dataclass

import boto3

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RAGConfig:
    knowledge_base_id: str = "KGISW1DO99"
    chat_model: str = "us.anthropic.claude-sonnet-4-6"
    max_chunks: int = 5
    # Tuned empirically — below 0.3, chunks tend to be from unrelated sections
    # that share financial jargon. Above 0.5 is too aggressive and drops
    # relevant context from differently-worded sections.
    relevance_floor: float = 0.3


config = RAGConfig()

bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")
bedrock_kb = boto3.client("bedrock-agent-runtime", region_name="us-east-1")

ANALYST_PERSONA = """You are FinSight, an investment analyst copilot. Your role is to help \
analysts research companies by answering questions based on annual reports, earnings \
transcripts, and regulatory filings.

CRITICAL RULES:
1. ONLY answer based on the provided context from retrieved documents. Never use your \
general knowledge about companies or financial figures.
2. If the context does not contain enough information to answer the question, say so \
clearly: "I don't have enough information in the uploaded documents to answer this."
3. For every claim you make, reference which document and section it comes from using \
the format [Source: document name, location].
4. When comparing figures across companies, present them in a clear structure.
5. If numbers or figures are mentioned, quote them exactly as they appear in the source.
6. Be concise and analytical — write like a research analyst, not a chatbot."""


def _retrieve(query: str) -> list[dict]:
    """Fetch relevant chunks from the Knowledge Base.

    Returns pre-filtered results — anything below the relevance floor
    is dropped to avoid polluting the prompt with noise.
    """
    try:
        response = bedrock_kb.retrieve(
            knowledgeBaseId=config.knowledge_base_id,
            retrievalQuery={"text": query},
            retrievalConfiguration={
                "vectorSearchConfiguration": {
                    "numberOfResults": config.max_chunks,
                }
            },
        )
    except Exception:
        logger.exception("Knowledge Base retrieval failed")
        return []

    chunks = []
    for r in response.get("retrievalResults", []):
        score = r.get("score", 0)
        if score < config.relevance_floor:
            continue

        s3_uri = r.get("location", {}).get("s3Location", {}).get("uri", "")

        chunks.append(
            {
                "content": r.get("content", {}).get("text", ""),
                "source": s3_uri.split("/")[-1] if s3_uri else "unknown",
                "s3_uri": s3_uri,
                "score": score,
            }
        )

    logger.info(
        "Retrieval: %d/%d chunks above relevance floor",
        len(chunks),
        len(response.get("retrievalResults", [])),
    )
    return chunks


def research_query(question: str) -> dict:
    """RAG pipeline: retrieve from the knowledge base, ground Claude's
    response in the retrieved context, return answer with citations.

    Uses the Converse API rather than InvokeModel — it's model-agnostic
    and returns token usage without parsing the response body.
    """
    chunks = _retrieve(question)

    # Build the context section of the prompt. Each chunk is labelled
    # so Claude can reference specific sources in its answer.
    if chunks:
        context_lines = []
        for i, c in enumerate(chunks, 1):
            context_lines.append(
                f"--- Source {i}: {c['source']} (relevance: {c['score']:.2f}) ---\n{c['content']}"
            )
        context = "\n\n".join(context_lines)
    else:
        context = "No relevant documents were found for this query."

    try:
        response = bedrock.converse(
            modelId=config.chat_model,
            system=[{"text": ANALYST_PERSONA}],
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "text": (
                                "Based on the following documents, answer the "
                                "analyst's question.\n\n"
                                f"RETRIEVED DOCUMENTS:\n{context}\n\n"
                                f"ANALYST'S QUESTION:\n{question}"
                            )
                        }
                    ],
                }
            ],
            inferenceConfig={
                "maxTokens": 2048,
                "temperature": 0.1,
            },
        )
    except Exception:
        logger.exception("Converse call failed")
        return {
            "answer": "I encountered an error generating a response. Please try again.",
            "citations": [],
            "chunk_count": 0,
            "is_grounded": False,
        }

    usage = response.get("usage", {})
    logger.info(
        "Tokens — in: %d, out: %d", usage.get("inputTokens", 0), usage.get("outputTokens", 0)
    )

    return {
        "answer": response["output"]["message"]["content"][0]["text"],
        "citations": [
            {
                "source": c["source"],
                "s3_uri": c["s3_uri"],
                "relevance_score": round(c["score"], 3),
                "text": c["content"],
            }
            for c in chunks
        ],
        "chunk_count": len(chunks),
        "is_grounded": bool(chunks),
        "token_usage": {
            "input": usage.get("inputTokens", 0),
            "output": usage.get("outputTokens", 0),
        },
    }


def research_query_stream(question: str):
    """Streaming variant of research_query. Yields SSE-formatted events.

    Retrieval happens upfront (not streamed), then Claude's response
    streams token-by-token via ConverseStream.
    """
    chunks = _retrieve(question)

    if chunks:
        context_lines = []
        for i, c in enumerate(chunks, 1):
            context_lines.append(
                f"--- Source {i}: {c['source']} (relevance: {c['score']:.2f}) ---\n{c['content']}"
            )
        context = "\n\n".join(context_lines)
    else:
        context = "No relevant documents were found for this query."

    citations = [
        {
            "source": c["source"],
            "s3_uri": c["s3_uri"],
            "relevance_score": round(c["score"], 3),
            "text": c["content"],
        }
        for c in chunks
    ]

    # Send citations first so the frontend can render the source panel
    # before the answer starts streaming
    citations_event = json.dumps(
        {
            "type": "citations",
            "citations": citations,
            "is_grounded": bool(chunks),
        }
    )
    yield f"data: {citations_event}\n\n"

    try:
        response = bedrock.converse_stream(
            modelId=config.chat_model,
            system=[{"text": ANALYST_PERSONA}],
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "text": (
                                "Based on the following documents, answer the "
                                "analyst's question.\n\n"
                                f"RETRIEVED DOCUMENTS:\n{context}\n\n"
                                f"ANALYST'S QUESTION:\n{question}"
                            )
                        }
                    ],
                }
            ],
            inferenceConfig={
                "maxTokens": 2048,
                "temperature": 0.1,
            },
        )
    except Exception:
        logger.exception("ConverseStream call failed")
        yield f"data: {json.dumps({'type': 'error', 'message': 'Failed to generate response'})}\n\n"
        return

    # ConverseStream returns an event stream with different event types:
    #   contentBlockDelta — the actual text tokens
    #   metadata — token usage stats (arrives at the end)
    for event in response["stream"]:
        if "contentBlockDelta" in event:
            text = event["contentBlockDelta"]["delta"].get("text", "")
            if text:
                yield f"data: {json.dumps({'type': 'delta', 'text': text})}\n\n"

        elif "metadata" in event:
            usage = event["metadata"].get("usage", {})
            done_event = json.dumps(
                {
                    "type": "done",
                    "token_usage": {
                        "input": usage.get("inputTokens", 0),
                        "output": usage.get("outputTokens", 0),
                    },
                }
            )
            yield f"data: {done_event}\n\n"


def chat(message: str) -> str:
    """Direct Claude call without RAG — used for non-research queries."""
    body = json.dumps(
        {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": message}],
        }
    )

    response = bedrock.invoke_model(
        modelId=config.chat_model,
        contentType="application/json",
        accept="application/json",
        body=body,
    )
    return json.loads(response["body"].read())["content"][0]["text"]

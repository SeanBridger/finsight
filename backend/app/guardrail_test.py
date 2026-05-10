"""Guardrail testing and trace utilities.

Provides:
1. Direct guardrail evaluation via ApplyGuardrail API (no model involved)
2. Trace extraction from Converse responses to prove guardrail assessment
"""

import logging
import os

import boto3

logger = logging.getLogger(__name__)
AWS_REGION = os.environ.get("AWS_DEFAULT_REGION", os.environ.get("AWS_REGION", "us-east-1"))

bedrock = boto3.client("bedrock-runtime", region_name=AWS_REGION)

GUARDRAIL_ID = os.environ.get("GUARDRAIL_ID", "")
GUARDRAIL_VERSION = os.environ.get("GUARDRAIL_VERSION", "")


def test_guardrail(text: str, source: str = "INPUT") -> dict:
    """Evaluate text directly against the guardrail — no model involved.

    This calls the ApplyGuardrail API, which runs the guardrail
    policies against the provided text and returns the assessment.
    Proves the guardrail works independently of Claude's system prompt.

    Args:
        text: The text to evaluate.
        source: "INPUT" or "OUTPUT" — which direction to evaluate.

    Returns:
        Dict with action (GUARDRAIL_INTERVENED or NONE), assessments,
        and usage metrics.
    """
    if not GUARDRAIL_ID or not GUARDRAIL_VERSION:
        return {"error": "Guardrail not configured"}

    try:
        response = bedrock.apply_guardrail(
            guardrailIdentifier=GUARDRAIL_ID,
            guardrailVersion=GUARDRAIL_VERSION,
            source=source,
            content=[{"text": {"text": text}}],
        )

        assessments = response.get("assessments", [])
        action = response.get("action", "NONE")
        usage = response.get("usage", {})

        # Flatten assessments into a readable summary
        summary = _summarise_assessments(assessments)

        return {
            "action": action,
            "blocked": action == "GUARDRAIL_INTERVENED",
            "assessments": summary,
            "usage": usage,
            "blocked_response": (
                response.get("outputs", [{}])[0].get("text", "")
                if action == "GUARDRAIL_INTERVENED"
                else None
            ),
        }

    except Exception as e:
        logger.exception("ApplyGuardrail failed")
        return {"error": str(e)}


def extract_guardrail_trace(response: dict) -> dict | None:
    """Extract guardrail assessment trace from a Converse response.

    The trace shows which policies were evaluated, what was detected,
    and what action was taken — even when the guardrail didn't block
    (i.e. Claude's system prompt handled the refusal).

    Returns None if no guardrail trace is present.
    """
    trace = response.get("trace", {})
    guardrail_trace = trace.get("guardrail", {})

    if not guardrail_trace:
        return None

    result = {
        "action_reason": guardrail_trace.get("actionReason"),
        "input_assessment": {},
        "output_assessment": {},
    }

    # Input assessment — did the guardrail flag the user's input?
    input_assessment = guardrail_trace.get("inputAssessment", {})
    for key, assessment in input_assessment.items():
        result["input_assessment"] = _extract_assessment(assessment)

    # Output assessment — did the guardrail flag Claude's response?
    output_assessments = guardrail_trace.get("outputAssessments", {})
    for key, assessments in output_assessments.items():
        if isinstance(assessments, list):
            for assessment in assessments:
                result["output_assessment"] = _extract_assessment(assessment)
        else:
            result["output_assessment"] = _extract_assessment(assessments)

    return result


def _extract_assessment(assessment: dict) -> dict:
    """Extract a readable summary from a single guardrail assessment."""
    result = {}

    # Topic policy
    topic_policy = assessment.get("topicPolicy", {})
    topics = topic_policy.get("topics", [])
    if topics:
        result["topic_policy"] = [
            {
                "name": t.get("name"),
                "action": t.get("action"),
                "detected": t.get("detected", False),
            }
            for t in topics
        ]

    # Content policy
    content_policy = assessment.get("contentPolicy", {})
    filters = content_policy.get("filters", [])
    if filters:
        result["content_policy"] = [
            {
                "type": f.get("type"),
                "confidence": f.get("confidence"),
                "action": f.get("action"),
                "detected": f.get("detected", False),
            }
            for f in filters
        ]

    # Word policy
    word_policy = assessment.get("wordPolicy", {})
    custom_words = word_policy.get("customWords", [])
    managed_words = word_policy.get("managedWordLists", [])
    if custom_words or managed_words:
        result["word_policy"] = {
            "custom_words": [
                {"match": w.get("match"), "action": w.get("action")} for w in custom_words
            ],
            "managed_words": [
                {
                    "match": w.get("match"),
                    "type": w.get("type"),
                    "action": w.get("action"),
                }
                for w in managed_words
            ],
        }

    # Invocation metrics
    metrics = assessment.get("invocationMetrics", {})
    if metrics:
        result["latency_ms"] = metrics.get("guardrailProcessingLatency")
        result["usage"] = metrics.get("usage", {})

    return result


def _summarise_assessments(assessments: list[dict]) -> list[dict]:
    """Summarise ApplyGuardrail assessment results."""
    summaries = []
    for assessment in assessments:
        summaries.append(_extract_assessment(assessment))
    return summaries

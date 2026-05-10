"""Pre-Bedrock input validation and prompt injection detection.

This runs BEFORE hitting Bedrock, catching obvious prompt injection
attempts without incurring a Bedrock API call. Bedrock Guardrails
provide a second layer of defence during the Converse call itself.
"""

import re

# Patterns that indicate prompt injection attempts
_INJECTION_PATTERNS = [
    r"ignore\s+your\s+(instructions|prompts|rules|guidelines)",
    r"ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|rules)",
    r"disregard\s+(all\s+)?(previous|prior|above|earlier)",
    r"forget\s+(all\s+)?(previous|prior|your)(\s+\w+)?\s+(instructions|rules|context|guidelines)",
    r"you\s+are\s+now\s+(?!an?\s+(?:investment\s+)?analyst)",
    r"new\s+instructions?\s*:",
    r"system\s*:\s*",
    r"<\s*system\s*>",
    r"\[INST\]",
    r"(?:human|user|assistant)\s*:\s*(?:ignore|override|forget)",
    r"do\s+not\s+follow\s+your\s+(instructions|rules|guidelines)",
    r"pretend\s+(?:you'?re|you\s+are)\s+(?!an?\s+(?:analyst|researcher))",
    r"jailbreak",
    r"dan\s+mode",
    r"bypass\s+(?:your\s+)?(?:filters?|safety|guardrails?|restrictions?)",
]

_COMPILED = [re.compile(p, re.IGNORECASE) for p in _INJECTION_PATTERNS]

MAX_INPUT_LENGTH = 10_000

REJECTION_MESSAGE = (
    "Your message was flagged by our input safety filter. "
    "Please rephrase your question to focus on financial document analysis."
)


def validate_input(text: str) -> tuple[bool, str]:
    """Validate user input before sending to Bedrock.

    Returns (is_valid, rejection_reason).
    If is_valid is True, rejection_reason is empty.
    """
    if not text or not text.strip():
        return False, "Empty input."

    if len(text) > MAX_INPUT_LENGTH:
        return False, f"Input too long ({len(text):,} characters, maximum is {MAX_INPUT_LENGTH:,})."

    for pattern in _COMPILED:
        if pattern.search(text):
            return False, REJECTION_MESSAGE

    return True, ""

import logging
import os
from datetime import UTC, datetime
from decimal import Decimal

import boto3

logger = logging.getLogger(__name__)
AWS_REGION = os.environ.get("AWS_DEFAULT_REGION", os.environ.get("AWS_REGION", "us-east-1"))

TABLE = os.environ.get("CHAT_HISTORY_TABLE", "finsight-chat-history")
USER_ID = "default"  # Hardcoded until Cognito is added

dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
table = dynamodb.Table(TABLE)


def _sanitize_for_dynamo(obj):
    """Convert floats to Decimals for DynamoDB."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _sanitize_for_dynamo(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_dynamo(i) for i in obj]
    return obj


def list_sessions() -> list[dict]:
    """List all sessions for the current user, newest first."""
    try:
        response = table.query(
            KeyConditionExpression="userId = :uid",
            ExpressionAttributeValues={":uid": USER_ID},
            ProjectionExpression="sessionId, title, updatedAt, messageCount",
        )
        items = response.get("Items", [])
        items.sort(key=lambda x: x.get("updatedAt", ""), reverse=True)
        return items
    except Exception:
        logger.exception("Failed to list sessions")
        return []


def get_session(session_id: str) -> dict | None:
    """Load a full session with all messages."""
    try:
        response = table.get_item(Key={"userId": USER_ID, "sessionId": session_id})
        return response.get("Item")
    except Exception:
        logger.exception("Failed to get session %s", session_id)
        return None


def save_session(session_id: str, messages: list[dict], title: str | None = None) -> dict:
    """Save or update a session."""
    now = datetime.now(UTC).isoformat()

    # Auto-generate title from first user message
    if not title:
        for msg in messages:
            if msg.get("role") == "user":
                content = msg.get("content", "")
                title = content[:80] + ("..." if len(content) > 80 else "")
                break
        title = title or "New conversation"

    item = {
        "userId": USER_ID,
        "sessionId": session_id,
        "title": title,
        "messages": _sanitize_for_dynamo(messages),
        "messageCount": len(messages),
        "updatedAt": now,
    }

    try:
        table.put_item(Item=item)
        return {"sessionId": session_id, "title": title, "updatedAt": now}
    except Exception:
        logger.exception("Failed to save session %s", session_id)
        return {"error": "Failed to save session"}

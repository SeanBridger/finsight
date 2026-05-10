import json
import logging
import os
import uuid
from datetime import UTC, datetime
from decimal import Decimal

import boto3
from botocore.config import Config

logger = logging.getLogger(__name__)
AWS_REGION = os.environ.get("AWS_DEFAULT_REGION", os.environ.get("AWS_REGION", "us-east-1"))

BUCKET = os.environ.get("DOCUMENTS_BUCKET", "finsight-documents-284394464353")
TABLE = os.environ.get("DOCUMENT_METADATA_TABLE", "finsight-document-metadata")
KB_ID = os.environ.get("KNOWLEDGE_BASE_ID", "")
DS_ID = os.environ.get("DATA_SOURCE_ID", "")
SYNC_FUNCTION = os.environ.get("SYNC_FUNCTION_NAME", "finsight-kb-sync")

dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
table = dynamodb.Table(TABLE)

s3_client = boto3.client(
    "s3",
    region_name=AWS_REGION,
    config=Config(signature_version="s3v4"),
)

lambda_client = boto3.client("lambda", region_name=AWS_REGION)
bedrock_agent = boto3.client("bedrock-agent", region_name=AWS_REGION)

BEDROCK_JOB_TERMINAL_STATUSES = {"COMPLETE", "FAILED"}


def _sanitize_for_dynamo(obj):
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _sanitize_for_dynamo(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_dynamo(i) for i in obj]
    return obj


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _refresh_ingestion_status(doc: dict) -> None:
    job_id = doc.get("ingestionJobId")
    if doc.get("status") != "ingesting" or not job_id or not KB_ID or not DS_ID:
        return

    try:
        response = bedrock_agent.get_ingestion_job(
            knowledgeBaseId=KB_ID,
            dataSourceId=DS_ID,
            ingestionJobId=job_id,
        )
    except Exception:
        logger.exception("Failed to refresh ingestion job %s", job_id)
        return

    job = response.get("ingestionJob", {})
    job_status = job.get("status", "")
    stats = _sanitize_for_dynamo(job.get("statistics", {}))
    now = _now()

    if job_status in BEDROCK_JOB_TERMINAL_STATUSES:
        status = "ready" if job_status == "COMPLETE" else "failed"
        table.update_item(
            Key={"documentId": doc["documentId"]},
            UpdateExpression=(
                "SET #s = :s, ingestionStatus = :js, ingestionStats = :stats, "
                "ingestionUpdatedAt = :t"
            ),
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":s": status,
                ":js": job_status,
                ":stats": stats,
                ":t": now,
            },
        )
        doc["status"] = status
    else:
        table.update_item(
            Key={"documentId": doc["documentId"]},
            UpdateExpression=(
                "SET ingestionStatus = :js, ingestionStats = :stats, ingestionUpdatedAt = :t"
            ),
            ExpressionAttributeValues={
                ":js": job_status,
                ":stats": stats,
                ":t": now,
            },
        )

    doc["ingestionStatus"] = job_status
    doc["ingestionStats"] = stats
    doc["ingestionUpdatedAt"] = now


def list_documents() -> list[dict]:
    """List all documents, sorted by upload date (newest first)."""
    try:
        response = table.query(
            IndexName="all-documents",
            KeyConditionExpression="gsi1pk = :pk",
            ExpressionAttributeValues={":pk": "DOC"},
            ScanIndexForward=False,
        )
        docs = response.get("Items", [])
        for doc in docs:
            _refresh_ingestion_status(doc)
        return docs
    except Exception:
        logger.exception("Failed to list documents")
        return []


def create_upload_url(
    filename: str,
    company: str,
    doc_type: str,
    period: str,
) -> dict:
    """Create a presigned PUT URL and register the document in DynamoDB.

    The frontend uploads directly to S3 using the presigned URL,
    then calls /documents/confirm to mark it as uploaded.
    """
    document_id = str(uuid.uuid4())
    s3_key = f"documents/{filename}"
    now = _now()

    table.put_item(
        Item={
            "documentId": document_id,
            "gsi1pk": "DOC",
            "filename": filename,
            "s3Key": s3_key,
            "company": company,
            "docType": doc_type,
            "period": period,
            "status": "uploading",
            "uploadedAt": now,
        }
    )

    presigned_url = s3_client.generate_presigned_url(
        ClientMethod="put_object",
        Params={
            "Bucket": BUCKET,
            "Key": s3_key,
            "ContentType": "application/pdf",
        },
        ExpiresIn=300,
    )

    return {
        "upload_url": presigned_url,
        "document_id": document_id,
        "s3_key": s3_key,
    }


def confirm_upload(document_id: str) -> dict:
    """Mark a document as uploaded and ready for ingestion."""
    now = _now()
    table.update_item(
        Key={"documentId": document_id},
        UpdateExpression="SET #s = :s, confirmedAt = :t",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": "uploaded", ":t": now},
    )
    return {"status": "uploaded"}


def sync_knowledge_base() -> dict:
    """Trigger a KB data source sync via Lambda.

    The Lambda runs outside the VPC so Bedrock can validate the
    Pinecone connection during ingestion. Fargate can't do this
    directly because the bedrock-agent PrivateLink endpoint doesn't
    support third-party vector store validation.
    """
    if not KB_ID or not DS_ID:
        return {"error": "Knowledge base sync is not configured"}

    try:
        response = lambda_client.invoke(
            FunctionName=SYNC_FUNCTION,
            InvocationType="RequestResponse",
            Payload=json.dumps(
                {
                    "knowledge_base_id": KB_ID,
                    "data_source_id": DS_ID,
                    "description": "Sync triggered from FinSight upload",
                }
            ),
        )
        result = json.loads(response["Payload"].read())
        body = json.loads(result.get("body", "{}"))

        if result.get("statusCode") == 200:
            job_id = body.get("ingestion_job_id", "unknown")
            logger.info("Started ingestion job via Lambda: %s", job_id)

            docs = list_documents()
            now = _now()
            for doc in docs:
                if doc.get("status") == "uploaded":
                    table.update_item(
                        Key={"documentId": doc["documentId"]},
                        UpdateExpression=(
                            "SET #s = :s, ingestionJobId = :job, "
                            "ingestionStatus = :js, ingestionStartedAt = :t"
                        ),
                        ExpressionAttributeNames={"#s": "status"},
                        ExpressionAttributeValues={
                            ":s": "ingesting",
                            ":job": job_id,
                            ":js": body.get("status", "STARTING"),
                            ":t": now,
                        },
                    )

            return {
                "ingestion_job_id": job_id,
                "status": body.get("status", "STARTING"),
            }
        else:
            logger.error("Lambda sync failed: %s", body)
            return {"error": body.get("error", "Sync failed")}
    except Exception:
        logger.exception("Failed to invoke sync Lambda")
        return {"error": "Failed to invoke sync Lambda"}

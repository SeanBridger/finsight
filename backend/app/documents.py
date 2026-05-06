import json
import logging
import os
import uuid
from datetime import UTC, datetime

import boto3
from botocore.config import Config

logger = logging.getLogger(__name__)

BUCKET = os.environ.get("DOCUMENTS_BUCKET", "finsight-documents-284394464353")
TABLE = os.environ.get("DOCUMENT_METADATA_TABLE", "finsight-document-metadata")
KB_ID = os.environ.get("KNOWLEDGE_BASE_ID", "KGISW1DO99")
DS_ID = os.environ.get("DATA_SOURCE_ID", "RI9JEO7YN7")
SYNC_FUNCTION = os.environ.get("SYNC_FUNCTION_NAME", "finsight-kb-sync")

dynamodb = boto3.resource("dynamodb", region_name="us-east-1")
table = dynamodb.Table(TABLE)

s3_client = boto3.client(
    "s3",
    region_name="us-east-1",
    config=Config(signature_version="s3v4"),
)

lambda_client = boto3.client("lambda", region_name="us-east-1")


def list_documents() -> list[dict]:
    """List all documents, sorted by upload date (newest first)."""
    try:
        response = table.query(
            IndexName="all-documents",
            KeyConditionExpression="gsi1pk = :pk",
            ExpressionAttributeValues={":pk": "DOC"},
            ScanIndexForward=False,
        )
        return response.get("Items", [])
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
    now = datetime.now(UTC).isoformat()

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
    now = datetime.now(UTC).isoformat()
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

            # Mark all non-terminal docs as ready.
            # Slightly optimistic — ingestion completes async in ~30-60s
            # but avoids needing a job-polling mechanism.
            docs = list_documents()
            for doc in docs:
                if doc.get("status") in ("uploaded", "ingesting"):
                    table.update_item(
                        Key={"documentId": doc["documentId"]},
                        UpdateExpression="SET #s = :s",
                        ExpressionAttributeNames={"#s": "status"},
                        ExpressionAttributeValues={":s": "ready"},
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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.agent import agent_research, agent_research_stream
from app.bedrock import chat, research_query, research_query_stream
from app.documents import (
    confirm_upload,
    create_upload_url,
    list_documents,
    sync_knowledge_base,
)
from app.guardrail_test import test_guardrail
from app.sessions import get_session, list_sessions, save_session

app = FastAPI(title="FinSight API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:4173",
    ],
    allow_origin_regex=r"https://[a-z0-9]+\.cloudfront\.net",
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    response: str


class Citation(BaseModel):
    source: str
    s3_uri: str
    relevance_score: float


class TokenUsage(BaseModel):
    input: int
    output: int


class ResearchResponse(BaseModel):
    answer: str
    citations: list[Citation]
    chunk_count: int
    is_grounded: bool
    token_usage: TokenUsage | None = None


class UploadRequest(BaseModel):
    filename: str
    company: str
    doc_type: str
    period: str


class ConfirmUploadRequest(BaseModel):
    document_id: str


class SaveSessionRequest(BaseModel):
    session_id: str
    messages: list[dict]
    title: str | None = None


class ToolCall(BaseModel):
    tool: str
    input: dict
    result_summary: str
    iteration: int


class AgentResponse(BaseModel):
    answer: str
    tool_calls: list[ToolCall]
    citations: list[dict]
    is_grounded: bool
    iterations: int
    token_usage: TokenUsage | None = None


class AgentRequest(BaseModel):
    message: str
    history: list[dict] = []


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    return ChatResponse(response=chat(request.message))


@app.post("/research", response_model=ResearchResponse)
async def research_endpoint(request: ChatRequest):
    return ResearchResponse(**research_query(request.message))


@app.post("/research/stream")
async def research_stream_endpoint(request: ChatRequest):
    return StreamingResponse(
        research_query_stream(request.message),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/documents/list")
async def list_documents_endpoint():
    return {"documents": list_documents()}


@app.post("/documents/upload")
async def upload_document_endpoint(request: UploadRequest):
    return create_upload_url(
        filename=request.filename,
        company=request.company,
        doc_type=request.doc_type,
        period=request.period,
    )


@app.post("/documents/confirm")
async def confirm_upload_endpoint(request: ConfirmUploadRequest):
    return confirm_upload(request.document_id)


@app.post("/documents/sync")
async def sync_endpoint():
    return sync_knowledge_base()


@app.get("/sessions/list")
async def list_sessions_endpoint():
    return {"sessions": list_sessions()}


@app.get("/sessions/{session_id}")
async def get_session_endpoint(session_id: str):
    session = get_session(session_id)
    if not session:
        return {"error": "Session not found"}
    return session


@app.post("/sessions/save")
async def save_session_endpoint(request: SaveSessionRequest):
    return save_session(
        session_id=request.session_id,
        messages=request.messages,
        title=request.title,
    )


@app.post("/research/agent", response_model=AgentResponse)
async def agent_research_endpoint(request: AgentRequest):
    return AgentResponse(
        **agent_research(request.message, request.history),
    )


@app.post("/research/agent/stream")
async def agent_stream_endpoint(request: AgentRequest):
    return StreamingResponse(
        agent_research_stream(request.message, request.history),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/guardrail/test")
async def guardrail_test(request: dict):
    text = request.get("text", "")
    source = request.get("source", "INPUT")
    return test_guardrail(text, source)

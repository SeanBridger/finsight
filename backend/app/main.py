from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.bedrock import chat, research_query, research_query_stream

app = FastAPI(title="FinSight API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:4173",
    ],
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


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    """Direct Claude — no document retrieval."""
    return ChatResponse(response=chat(request.message))


@app.post("/research", response_model=ResearchResponse)
async def research_endpoint(request: ChatRequest):
    """RAG-powered research against the document corpus."""
    return ResearchResponse(**research_query(request.message))


@app.post("/research/stream")
async def research_stream_endpoint(request: ChatRequest):
    """Streaming RAG research — tokens sent as Server-Sent Events."""
    return StreamingResponse(
        research_query_stream(request.message),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

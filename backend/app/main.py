from fastapi import FastAPI
from pydantic import BaseModel

from app.bedrock import chat, research_query

app = FastAPI(title="FinSight API", version="0.1.0")


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

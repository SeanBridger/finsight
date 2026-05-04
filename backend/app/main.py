from fastapi import FastAPI
from pydantic import BaseModel

from app.bedrock import chat

app = FastAPI(
    title="FinSight API",
    description="Investment Analyst Copilot backend",
    version="0.1.0",
)


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    response: str


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    response = chat(request.message)
    return ChatResponse(response=response)

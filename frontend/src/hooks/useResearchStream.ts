import { useCallback, useRef, useState } from "react";
import type { ActiveTool, Message, SSEEvent } from "../types/research";

const API_URL = import.meta.env.VITE_API_URL || "";

export function useResearchStream() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeTool, setActiveTool] = useState<ActiveTool | null>(null);
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());
  const [saveCount, setSaveCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const saveSession = useCallback(
    async (msgs: Message[]) => {
      try {
        await fetch(`${API_URL}/sessions/save`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            messages: msgs.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              citations: m.citations,
              isGrounded: m.isGrounded,
              tokenUsage: m.tokenUsage,
              toolCalls: m.toolCalls,
            })),
          }),
        });
        setSaveCount((c) => c + 1);
      } catch {
        // Silent fail
      }
    },
    [sessionId],
  );

  const send = useCallback(
    async (question: string) => {
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: question,
      };

      const assistantId = crypto.randomUUID();
      const assistantMsg: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);
      setActiveTool(null);

      abortRef.current = new AbortController();

      try {
        const res = await fetch(`${API_URL}/research/agent/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: question }),
          signal: abortRef.current.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finalMessages: Message[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;

            const event: SSEEvent = JSON.parse(raw);

            if (event.type === "tool_call") {
              setActiveTool({
                tool: event.tool,
                input: event.input,
              });
              continue;
            }

            if (event.type === "tool_result") {
              setActiveTool(null);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, toolsUsed: true } : m,
                ),
              );
              continue;
            }

            if (event.type === "error") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: event.message, isStreaming: false }
                    : m,
                ),
              );
              continue;
            }

            setMessages((prev) => {
              const updated = prev.map((m) => {
                if (m.id !== assistantId) return m;

                switch (event.type) {
                  case "citations":
                    return {
                      ...m,
                      citations: event.citations,
                      isGrounded: event.is_grounded,
                    };
                  case "delta":
                    return { ...m, content: m.content + event.text };
                  case "done":
                    return {
                      ...m,
                      tokenUsage: event.token_usage,
                      toolCalls: event.tool_calls,
                      isStreaming: false,
                    };
                  default:
                    return m;
                }
              });
              finalMessages = updated;
              return updated;
            });
          }
        }

        if (finalMessages.length > 0) {
          void saveSession(finalMessages);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: "Something went wrong. Please try again.",
                  isStreaming: false,
                }
              : m,
          ),
        );
      } finally {
        setIsStreaming(false);
        setActiveTool(null);
      }
    },
    [saveSession],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setActiveTool(null);
    setMessages((prev) =>
      prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
    );
  }, []);

  const loadSession = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_URL}/sessions/${id}`);
      const data = await res.json();
      if (data.messages) {
        setSessionId(id);
        setMessages(data.messages);
      }
    } catch {
      console.error("Failed to load session");
    }
  }, []);

  const newSession = useCallback(() => {
    setSessionId(crypto.randomUUID());
    setMessages([]);
  }, []);

  return {
    messages,
    isStreaming,
    activeTool,
    sessionId,
    saveCount,
    send,
    stop,
    loadSession,
    newSession,
  };
}
import { useCallback, useRef, useState } from "react";
import type { Message, SSEEvent } from "../types/research";

const API_URL = import.meta.env.VITE_API_URL || "";

export function useResearchStream() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
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

      abortRef.current = new AbortController();

      try {
        const res = await fetch(`${API_URL}/research/stream`, {
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
            const json = line.slice(6).trim();
            if (!json) continue;

            const event: SSEEvent = JSON.parse(json);

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

        // Auto-save after streaming completes
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
      }
    },
    [saveSession],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages((prev) => prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)));
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
    sessionId,
    saveCount,
    send,
    stop,
    loadSession,
    newSession,
  };
}

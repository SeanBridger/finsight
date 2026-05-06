import { useCallback, useRef, useState } from "react";
import type { Message, SSEEvent } from "../types/research";

const API_URL = import.meta.env.VITE_API_URL || "";

export function useResearchStream() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (question: string) => {
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

          setMessages((prev) =>
            prev.map((m) => {
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
            }),
          );
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: "Something went wrong. Please try again.", isStreaming: false }
            : m,
        ),
      );
    } finally {
      setIsStreaming(false);
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages((prev) => prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)));
  }, []);

  return { messages, isStreaming, send, stop };
}

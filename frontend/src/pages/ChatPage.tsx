import { useEffect, useRef, useState } from "react";
import { ChatInput } from "../components/ChatInput";
import { CitationDrawer } from "../components/CitationDrawer";
import { MessageBubble } from "../components/MessageBubble";
import { SessionSidebar } from "../components/SessionSidebar";
import { useResearchStream } from "../hooks/useResearchStream";
import type { Citation } from "../types/research";

export function ChatPage() {
  const { messages, isStreaming, sessionId, saveCount, send, stop, loadSession, newSession } =
    useResearchStream();
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-1 overflow-hidden">
      <SessionSidebar
        currentSessionId={sessionId}
        onSelectSession={loadSession}
        onNewSession={newSession}
        refreshTrigger={saveCount}
      />

      <div className="flex flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="text-lg font-medium text-gray-400">Ask a research question</p>
                <p className="mt-1 text-sm text-gray-400">
                  Try: &quot;What was HSBC&apos;s net interest margin in 2024?&quot;
                </p>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} onCitationClick={setActiveCitation} />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="mx-auto w-full max-w-3xl">
          <ChatInput onSend={send} isStreaming={isStreaming} onStop={stop} />
        </div>
      </div>

      {activeCitation && (
        <CitationDrawer citation={activeCitation} onClose={() => setActiveCitation(null)} />
      )}
    </div>
  );
}

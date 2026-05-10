import { useEffect, useRef, useState } from "react";
import { ChatInput } from "../components/ChatInput";
import { CitationDrawer } from "../components/CitationDrawer";
import { MessageBubble } from "../components/MessageBubble";
import { SessionSidebar } from "../components/SessionSidebar";
import { useResearchStream } from "../hooks/useResearchStream";
import type { Citation } from "../types/research";

export function ChatPage() {
  const {
    messages,
    isStreaming,
    activeTool,
    sessionId,
    saveCount,
    send,
    stop,
    loadSession,
    newSession,
  } = useResearchStream();
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [backendDown, setBackendDown] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Health check on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL || ""}/health`);
        if (!res.ok) setBackendDown(true);
      } catch {
        setBackendDown(true);
      }
    })();
  }, []);

  return (
    <div className="flex flex-1 overflow-hidden">
      <SessionSidebar
        currentSessionId={sessionId}
        onSelectSession={loadSession}
        onNewSession={newSession}
        refreshTrigger={saveCount}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
      />

      <div className="flex flex-1 flex-col">
        {backendDown && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-700">
            Backend is unavailable — queries won't work until infrastructure is deployed.
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
                  <svg
                    className="h-6 w-6 text-blue-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                </div>
                <p className="text-lg font-medium text-gray-400">Ask a research question</p>
                <p className="mt-1 text-sm text-gray-400">
                  Compare metrics, extract data, and analyse filings across HSBC, Barclays, Lloyds,
                  and NatWest.
                </p>
                <div className="mx-auto mt-4 flex max-w-md flex-wrap justify-center gap-2">
                  {[
                    "Compare net interest margins across all banks",
                    "What was NatWest's RoTE in 2025?",
                    "Summarise HSBC's risk factors",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => send(q)}
                      className="rounded-full border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  activeTool={m.isStreaming ? activeTool : null}
                  onCitationClick={setActiveCitation}
                />
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

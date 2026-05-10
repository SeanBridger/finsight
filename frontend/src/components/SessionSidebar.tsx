import { useEffect, useState } from "react";
import { API_URL } from "../utils/api";

interface Session {
  sessionId: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

interface Props {
  currentSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  refreshTrigger?: number;
  collapsed?: boolean;
  onToggle?: () => void;
}

function formatTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

function SkeletonItem() {
  return (
    <div className="animate-pulse rounded-lg px-3 py-2">
      <div className="h-4 w-3/4 rounded bg-gray-100" />
      <div className="mt-1.5 h-3 w-1/2 rounded bg-gray-100" />
    </div>
  );
}

export function SessionSidebar({
  currentSessionId,
  onSelectSession,
  onNewSession,
  refreshTrigger,
  collapsed,
  onToggle,
}: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/sessions/list`);
        const data = await res.json();
        setSessions(data.sessions);
      } catch {
        // Silent fail
      } finally {
        setLoading(false);
      }
    })();
  }, [currentSessionId, refreshTrigger]);

  if (collapsed) {
    return (
      <div className="flex w-12 flex-col items-center border-r border-gray-200 bg-white pt-3">
        <button
          onClick={onToggle}
          className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          title="Show sessions"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-64 flex-shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="flex items-center gap-1 p-3">
        <button
          onClick={onNewSession}
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          + New Research
        </button>
        <button
          onClick={onToggle}
          className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          title="Hide sessions"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-1 px-2">
            <SkeletonItem />
            <SkeletonItem />
            <SkeletonItem />
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-xs text-gray-400">No previous sessions</p>
            <p className="mt-1 text-xs text-gray-300">Ask a question to start</p>
          </div>
        ) : (
          <div className="space-y-0.5 px-2">
            {sessions.map((s) => (
              <button
                key={s.sessionId}
                onClick={() => onSelectSession(s.sessionId)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  s.sessionId === currentSessionId
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                <p className="truncate font-medium">{s.title}</p>
                <p className="mt-0.5 text-xs text-gray-400">
                  {s.messageCount} messages · {formatTime(s.updatedAt)}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "";

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

export function SessionSidebar({
  currentSessionId,
  onSelectSession,
  onNewSession,
  refreshTrigger,
}: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
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
      }
    })();
  }, [currentSessionId, refreshTrigger]);

  return (
    <div className="flex h-full w-64 flex-col border-r border-gray-200 bg-white">
      <div className="p-3">
        <button
          onClick={onNewSession}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          + New Research
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-gray-400">No previous sessions</p>
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

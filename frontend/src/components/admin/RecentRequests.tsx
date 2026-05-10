import { formatMs, formatCost, formatTime } from "../../utils/formatters";
import type { RequestMetric } from "../../types/admin";

interface RecentRequestsProps {
  requests: RequestMetric[];
}

export function RecentRequests({ requests }: RecentRequestsProps) {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/60 p-4">
      <h3 className="mb-4 text-sm font-medium text-slate-300">Recent Requests</h3>
      <div className="max-h-100 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-800">
            <tr className="border-b border-slate-700 text-xs uppercase text-slate-400">
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Question</th>
              <th className="px-3 py-2 text-right">Latency</th>
              <th className="px-3 py-2 text-right">Tokens</th>
              <th className="px-3 py-2 text-right">Cost</th>
              <th className="px-3 py-2 text-right">Tools</th>
              <th className="px-3 py-2 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {requests.slice(0, 20).map((r, i) => (
              <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                <td className="whitespace-nowrap px-3 py-2 text-slate-400">
                  {formatTime(r.timestamp)}
                </td>
                <td className="max-w-75 truncate px-3 py-2" title={r.question}>
                  {r.question}
                </td>
                <td className="px-3 py-2 text-right text-slate-300">{formatMs(r.latencyMs)}</td>
                <td className="px-3 py-2 text-right text-slate-300">
                  {(r.inputTokens + r.outputTokens).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right text-slate-300">{formatCost(r.totalCost)}</td>
                <td className="px-3 py-2 text-right text-slate-300">{r.toolCallCount}</td>
                <td className="px-3 py-2 text-center">
                  {r.guardrailBlocked ? (
                    <span className="text-xs text-amber-400">🛡 Blocked</span>
                  ) : r.error ? (
                    <span className="text-xs text-red-400">✗ Error</span>
                  ) : (
                    <span className="text-xs text-emerald-400">✓ OK</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

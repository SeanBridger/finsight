import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const API_URL = import.meta.env.VITE_API_URL || "";

interface RequestMetric {
  timestamp: string;
  question: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  toolCallCount: number;
  toolsUsed: string[];
  iterations: number;
  guardrailBlocked: boolean;
  error: string | null;
}

interface Aggregates {
  totalRequests: number;
  blockedRequests: number;
  errorRequests: number;
  latency: { p50: number; p95: number; p99: number; avg: number };
  cost: { total: number; avg: number; max: number };
  tokens: {
    totalInput: number;
    totalOutput: number;
    avgInput: number;
    avgOutput: number;
  };
  tools: {
    avgCallsPerRequest: number;
    frequency: Record<string, number>;
  };
}

interface MetricsData {
  requests: RequestMetric[];
  aggregates: Aggregates;
}

const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-4">
      <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-semibold text-white">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

function formatMs(ms: number): string {
  if (ms > 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function AdminPage() {
  const [data, setData] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = async () => {
    try {
      const res = await fetch(`${API_URL}/metrics?days=7`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch metrics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      await fetchMetrics();
    };
    load();
  }, []);

  useEffect(() => {
    const interval = setInterval(fetchMetrics, 30_000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex-1 overflow-auto bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400">Loading metrics...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 overflow-auto bg-slate-900 flex items-center justify-center">
        <div className="text-red-400">Error: {error || "No data"}</div>
      </div>
    );
  }

  const { requests, aggregates: agg } = data;

  const chartData = [...requests].reverse().map((r) => ({
    time: formatTime(r.timestamp),
    latency: r.latencyMs,
    cost: r.totalCost,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    toolCalls: r.toolCallCount,
  }));

  const toolPieData = Object.entries(agg.tools.frequency).map(([name, count]) => ({
    name: name.replace(/_/g, " "),
    value: count,
  }));

  return (
    <div className="flex-1 overflow-auto bg-slate-900 text-white">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">FinSight Observability</h1>
            <p className="text-sm text-slate-400 mt-1">
              LLMOps dashboard — latency, cost, token usage, guardrail activity
            </p>
          </div>
          <button
            onClick={fetchMetrics}
            className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
          >
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-8">
          <StatCard label="Total Requests" value={agg.totalRequests.toString()} />
          <StatCard
            label="Avg Latency"
            value={formatMs(agg.latency.avg)}
            sub={`p95: ${formatMs(agg.latency.p95)}`}
          />
          <StatCard
            label="Total Cost"
            value={formatCost(agg.cost.total)}
            sub={`avg: ${formatCost(agg.cost.avg)}/req`}
          />
          <StatCard
            label="Avg Tokens"
            value={`${agg.tokens.avgInput + agg.tokens.avgOutput}`}
            sub={`in: ${agg.tokens.avgInput} / out: ${agg.tokens.avgOutput}`}
          />
          <StatCard
            label="Blocked"
            value={agg.blockedRequests.toString()}
            sub={`${agg.totalRequests > 0 ? ((agg.blockedRequests / agg.totalRequests) * 100).toFixed(0) : 0}% of requests`}
          />
          <StatCard
            label="Avg Tool Calls"
            value={agg.tools.avgCallsPerRequest.toFixed(1)}
            sub="per request"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-4">
            <h3 className="text-sm font-medium text-slate-300 mb-4">Request Latency</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#64748b" />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="#64748b"
                  tickFormatter={(v) => formatMs(v)}
                />
                <Tooltip
                  contentStyle={{
                    background: "#1e293b",
                    border: "1px solid #475569",
                    borderRadius: "6px",
                    fontSize: "12px",
                  }}
                  formatter={(value: unknown) => [formatMs(value as number), "Latency"]}
                />
                <Line
                  type="monotone"
                  dataKey="latency"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-4">
            <h3 className="text-sm font-medium text-slate-300 mb-4">Cost per Request</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#64748b" />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="#64748b"
                  tickFormatter={(v) => `$${v.toFixed(3)}`}
                />
                <Tooltip
                  contentStyle={{
                    background: "#1e293b",
                    border: "1px solid #475569",
                    borderRadius: "6px",
                    fontSize: "12px",
                  }}
                  formatter={(value: unknown) => [formatCost(value as number), "Cost"]}
                />
                <Bar dataKey="cost" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-4">
            <h3 className="text-sm font-medium text-slate-300 mb-4">Token Usage per Request</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#64748b" />
                <YAxis tick={{ fontSize: 11 }} stroke="#64748b" />
                <Tooltip
                  contentStyle={{
                    background: "#1e293b",
                    border: "1px solid #475569",
                    borderRadius: "6px",
                    fontSize: "12px",
                  }}
                />
                <Bar
                  dataKey="inputTokens"
                  fill="#6366f1"
                  stackId="tokens"
                  name="Input"
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="outputTokens"
                  fill="#10b981"
                  stackId="tokens"
                  name="Output"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-4">
            <h3 className="text-sm font-medium text-slate-300 mb-4">Tool Usage Distribution</h3>
            {toolPieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={toolPieData}
                    cx="50%"
                    cy="55%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) => `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`}
                  >
                    {toolPieData.map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "#1e293b",
                      border: "1px solid #475569",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-62.5 flex items-center justify-center text-slate-500">
                No tool usage data yet
              </div>
            )}
          </div>
        </div>

        <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-4">Recent Requests</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-xs uppercase border-b border-slate-700">
                  <th className="text-left py-2 px-3">Time</th>
                  <th className="text-left py-2 px-3">Question</th>
                  <th className="text-right py-2 px-3">Latency</th>
                  <th className="text-right py-2 px-3">Tokens</th>
                  <th className="text-right py-2 px-3">Cost</th>
                  <th className="text-right py-2 px-3">Tools</th>
                  <th className="text-center py-2 px-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {requests.slice(0, 20).map((r, i) => (
                  <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                    <td className="py-2 px-3 text-slate-400 whitespace-nowrap">
                      {formatTime(r.timestamp)}
                    </td>
                    <td className="py-2 px-3 max-w-75 truncate" title={r.question}>
                      {r.question}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-300">{formatMs(r.latencyMs)}</td>
                    <td className="py-2 px-3 text-right text-slate-300">
                      {(r.inputTokens + r.outputTokens).toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-300">
                      {formatCost(r.totalCost)}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-300">{r.toolCallCount}</td>
                    <td className="py-2 px-3 text-center">
                      {r.guardrailBlocked ? (
                        <span className="text-amber-400 text-xs">🛡 Blocked</span>
                      ) : r.error ? (
                        <span className="text-red-400 text-xs">✗ Error</span>
                      ) : (
                        <span className="text-emerald-400 text-xs">✓ OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

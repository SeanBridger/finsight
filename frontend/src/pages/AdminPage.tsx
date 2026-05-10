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

interface EvalResult {
  id: string;
  question: string;
  category: string;
  relevance: number;
  faithfulness: number;
  reasoning: string;
  latency_s: number;
  tool_calls: string[];
  guardrail_blocked: boolean;
}

interface EvalData {
  eval_id: string;
  timestamp: string;
  dataset_size: number;
  avg_relevance: number;
  avg_faithfulness: number;
  category_scores: Record<
    string,
    { count: number; avg_relevance: number; avg_faithfulness: number }
  >;
  results: EvalResult[];
}

const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/60 p-4">
      <div className="mb-1 text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-2xl font-semibold text-white">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function ScoreBar({ score, max = 5 }: { score: number; max?: number }) {
  const pct = (score / max) * 100;
  const color = score >= 4 ? "bg-emerald-500" : score >= 3 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-700">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-300">{score.toFixed(1)}</span>
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
  const [evalData, setEvalData] = useState<EvalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = async () => {
    try {
      const [metricsRes, evalRes] = await Promise.all([
        fetch(`${API_URL}/metrics?days=7`),
        fetch(`${API_URL}/eval/latest`),
      ]);
      if (!metricsRes.ok) throw new Error(`HTTP ${metricsRes.status}`);
      setData(await metricsRes.json());
      if (evalRes.ok) {
        const evalJson = await evalRes.json();
        if (evalJson && evalJson.eval_id) {
          setEvalData(evalJson);
        }
      }
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
      <div className="flex flex-1 items-center justify-center overflow-auto bg-slate-900">
        <div className="text-slate-400">Loading metrics...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-auto bg-slate-900">
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
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">FinSight Observability</h1>
            <p className="mt-1 text-sm text-slate-400">
              LLMOps dashboard — latency, cost, token usage, guardrail activity
            </p>
          </div>
          <button
            onClick={fetchMetrics}
            className="rounded bg-slate-700 px-3 py-1.5 text-sm transition-colors hover:bg-slate-600"
          >
            Refresh
          </button>
        </div>

        {/* Stat cards */}
        <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
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

        {/* Charts row 1: Latency + Cost */}
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/60 p-4">
            <h3 className="mb-4 text-sm font-medium text-slate-300">Request Latency</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#64748b" />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="#64748b"
                  tickFormatter={(v: number) => formatMs(v)}
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

          <div className="rounded-lg border border-slate-700/50 bg-slate-800/60 p-4">
            <h3 className="mb-4 text-sm font-medium text-slate-300">Cost per Request</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#64748b" />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="#64748b"
                  tickFormatter={(v: number) => `$${v.toFixed(3)}`}
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

        {/* Charts row 2: Token usage + Tool frequency */}
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/60 p-4">
            <h3 className="mb-4 text-sm font-medium text-slate-300">Token Usage per Request</h3>
            <ResponsiveContainer width="100%" height={250}>
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

          <div className="rounded-lg border border-slate-700/50 bg-slate-800/60 p-4">
            <h3 className="mb-4 text-sm font-medium text-slate-300">Tool Usage Distribution</h3>
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
              <div className="flex h-75 items-center justify-center text-slate-500">
                No tool usage data yet
              </div>
            )}
          </div>
        </div>

        {/* Evaluation Results */}
        {evalData && (
          <div className="mb-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">RAG Evaluation</h2>
              <span className="text-xs text-slate-500">
                Last run: {new Date(evalData.timestamp).toLocaleString("en-GB")}
              </span>
            </div>

            {/* Eval summary cards */}
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Questions" value={evalData.dataset_size.toString()} />
              <StatCard label="Avg Relevance" value={`${evalData.avg_relevance.toFixed(2)}/5.0`} />
              <StatCard
                label="Avg Faithfulness"
                value={`${evalData.avg_faithfulness.toFixed(2)}/5.0`}
              />
              <StatCard
                label="Categories"
                value={Object.keys(evalData.category_scores).length.toString()}
              />
            </div>

            {/* Category breakdown */}
            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
              {Object.entries(evalData.category_scores).map(([cat, scores]) => (
                <div
                  key={cat}
                  className="rounded-lg border border-slate-700/50 bg-slate-800/60 p-3"
                >
                  <div className="mb-2 text-xs font-medium text-slate-400">
                    {cat.replace(/_/g, " ")}
                    <span className="ml-1 text-slate-600">(n={scores.count})</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">Relevance</span>
                      <ScoreBar score={scores.avg_relevance} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">Faithfulness</span>
                      <ScoreBar score={scores.avg_faithfulness} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Per-question results table */}
            <div className="rounded-lg border border-slate-700/50 bg-slate-800/60 p-4">
              <h3 className="mb-4 text-sm font-medium text-slate-300">Per-Question Results</h3>
              <div className="max-h-100 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-800">
                    <tr className="border-b border-slate-700 text-xs uppercase text-slate-400">
                      <th className="px-3 py-2 text-left">Question</th>
                      <th className="px-3 py-2 text-left">Category</th>
                      <th className="px-3 py-2 text-center">Relevance</th>
                      <th className="px-3 py-2 text-center">Faithfulness</th>
                      <th className="px-3 py-2 text-right">Latency</th>
                      <th className="px-3 py-2 text-right">Tools</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evalData.results.map((r, i) => (
                      <tr
                        key={i}
                        className="border-b border-slate-700/50 hover:bg-slate-700/30"
                        title={r.reasoning}
                      >
                        <td className="max-w-75 truncate px-3 py-2">{r.question}</td>
                        <td className="px-3 py-2 text-slate-400">
                          {r.category.replace(/_/g, " ")}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <ScoreBar score={r.relevance} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <ScoreBar score={r.faithfulness} />
                        </td>
                        <td className="px-3 py-2 text-right text-slate-300">
                          {r.latency_s.toFixed(1)}s
                        </td>
                        <td className="px-3 py-2 text-right text-slate-300">
                          {r.tool_calls.length}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Recent requests table */}
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
                    <td className="px-3 py-2 text-right text-slate-300">
                      {formatCost(r.totalCost)}
                    </td>
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
      </div>
    </div>
  );
}

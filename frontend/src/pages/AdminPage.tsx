import { useEffect, useState } from "react";
import type { MetricsData, EvalData } from "../types/admin";
import { StatCard } from "../components/admin/StatCard";
import { MetricsCharts } from "../components/admin/MetricsCharts";
import { EvalResults } from "../components/admin/EvalResults";
import { RecentRequests } from "../components/admin/RecentRequests";
import { formatMs, formatCost, formatTime } from "../utils/formatters";
import { API_URL } from "../utils/api";

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

        <MetricsCharts chartData={chartData} toolPieData={toolPieData} />

        {evalData && <EvalResults evalData={evalData} />}

        <RecentRequests requests={requests} />
      </div>
    </div>
  );
}

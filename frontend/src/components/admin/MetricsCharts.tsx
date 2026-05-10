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
import { formatMs, formatCost } from "../../utils/formatters";

const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

interface ChartDataPoint {
  time: string;
  latency: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
}

interface ToolPieDataPoint {
  name: string;
  value: number;
}

interface MetricsChartsProps {
  chartData: ChartDataPoint[];
  toolPieData: ToolPieDataPoint[];
}

export function MetricsCharts({ chartData, toolPieData }: MetricsChartsProps) {
  return (
    <>
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
    </>
  );
}

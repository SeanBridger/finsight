import { ScoreBar } from "./ScoreBar";
import { StatCard } from "./StatCard";
import type { EvalData } from "../../types/admin";

interface EvalResultsProps {
  evalData: EvalData;
}

export function EvalResults({ evalData }: EvalResultsProps) {
  return (
    <div className="mb-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">RAG Evaluation</h2>
        <span className="text-xs text-slate-500">
          Last run: {new Date(evalData.timestamp).toLocaleString("en-GB")}
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Questions" value={evalData.dataset_size.toString()} />
        <StatCard label="Avg Relevance" value={`${evalData.avg_relevance.toFixed(2)}/5.0`} />
        <StatCard label="Avg Faithfulness" value={`${evalData.avg_faithfulness.toFixed(2)}/5.0`} />
        <StatCard
          label="Categories"
          value={Object.keys(evalData.category_scores).length.toString()}
        />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        {Object.entries(evalData.category_scores).map(([cat, scores]) => (
          <div key={cat} className="rounded-lg border border-slate-700/50 bg-slate-800/60 p-3">
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
                  <td className="px-3 py-2 text-slate-400">{r.category.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2 text-center">
                    <ScoreBar score={r.relevance} />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <ScoreBar score={r.faithfulness} />
                  </td>
                  <td className="px-3 py-2 text-right text-slate-300">{r.latency_s.toFixed(1)}s</td>
                  <td className="px-3 py-2 text-right text-slate-300">{r.tool_calls.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

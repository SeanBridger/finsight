export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/60 p-4">
      <div className="mb-1 text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-2xl font-semibold text-white">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

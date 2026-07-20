import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell, CartesianGrid } from "recharts";
import { SEVERITY, SEVERITY_HEX, TYPE_LABEL } from "../lib/constants";

export default function DiscrepancyChart({ kpis }) {
  if (!kpis) return null;
  const data = Object.entries(kpis.by_type || {})
    .filter(([t]) => t !== "MATCHED")
    .map(([t, c]) => ({
      type: t,
      label: TYPE_LABEL[t] || t,
      count: c,
      color: SEVERITY_HEX[SEVERITY[t] || "amber"],
    }))
    .sort((a, b) => b.count - a.count);

  if (!data.length) {
    return (
      <div
        data-testid="chart-empty"
        className="flex h-[280px] items-center justify-center rounded-lg border border-slate-200 bg-white text-sm text-slate-500"
      >
        No discrepancies — everything reconciled.
      </div>
    );
  }

  return (
    <div
      data-testid="discrepancy-chart"
      className="rounded-lg border border-slate-200 bg-white p-5"
    >
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="font-display text-lg font-bold text-slate-900">
          Discrepancies by type
        </h3>
        <span className="text-xs text-slate-500">
          {data.reduce((s, d) => s + d.count, 0)} total
        </span>
      </div>
      <div style={{ width: "100%", height: 280, minWidth: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "#475569" }}
              angle={-20}
              textAnchor="end"
              interval={0}
              height={60}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: "#475569" }}
              width={30}
            />
            <Tooltip
              cursor={{ fill: "#f1f5f9" }}
              contentStyle={{
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                fontSize: 12,
                background: "#fff",
              }}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {data.map((d) => (
                <Cell key={d.type} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

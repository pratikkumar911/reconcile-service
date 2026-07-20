import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Skeleton } from "../components/ui/skeleton";
import { fmtUsd, fmtNum } from "../lib/constants";
import { ArrowRight, FileText } from "lucide-react";

export default function RunsPage() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/runs");
        setRuns(data);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-500">
          History
        </div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-slate-900">
          Runs history
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Every reconciliation run you've executed. Click any row to open its dashboard.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {loading ? (
          <div className="p-4 space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <div
            data-testid="runs-empty"
            className="p-10 text-center text-sm text-slate-500"
          >
            No runs yet — head to the dashboard and upload your first CSVs.
          </div>
        ) : (
          <ul className="divide-y divide-slate-200">
            {runs.map((r) => {
              const totalDisc = Object.entries(r.discrepancy_counts || {})
                .filter(([t]) => t !== "MATCHED")
                .reduce((s, [, c]) => s + c, 0);
              return (
                <li key={r.id}>
                  <Link
                    to={`/runs/${r.id}`}
                    data-testid={`run-row-${r.id}`}
                    className="flex items-center gap-4 p-4 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 truncate font-mono text-xs text-slate-800">
                        {r.orders_filename}{" "}
                        <span className="text-slate-400">+</span>{" "}
                        {r.payments_filename}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {new Date(r.created_at).toLocaleString()} ·{" "}
                        {fmtNum(r.orders_count)} orders · {fmtNum(r.payments_count)} payments
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs uppercase tracking-wide text-slate-500 font-bold">
                        Money at risk
                      </div>
                      <div className="font-display text-lg font-black tabular-nums text-red-600">
                        {fmtUsd(r.total_money_at_risk_usd)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs uppercase tracking-wide text-slate-500 font-bold">
                        Discrepancies
                      </div>
                      <div className="font-display text-lg font-black tabular-nums text-slate-900">
                        {fmtNum(totalDisc)}
                      </div>
                    </div>
                    <ArrowRight className="h-5 w-5 text-slate-400" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

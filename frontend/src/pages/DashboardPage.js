import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "@/lib/api";
import UploadPanel from "@/components/UploadPanel";
import KpiCards from "@/components/KpiCards";
import DiscrepancyChart from "@/components/DiscrepancyChart";
import DiscrepancyTable from "@/components/DiscrepancyTable";
import ExplainSheet from "@/components/ExplainSheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

export default function DashboardPage() {
  const { runId: routeRunId } = useParams();
  const [runs, setRuns] = useState([]);
  const [currentRun, setCurrentRun] = useState(null);
  const [kpis, setKpis] = useState(null);
  const [rows, setRows] = useState([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  const loadRuns = useCallback(async () => {
    const { data } = await api.get("/runs");
    setRuns(data);
    return data;
  }, []);

  const loadRun = useCallback(async (runId) => {
    setLoadingRows(true);
    try {
      const [kpiRes, discRes, runRes] = await Promise.all([
        api.get(`/runs/${runId}/kpis`),
        api.get(`/runs/${runId}/discrepancies`),
        api.get(`/runs/${runId}`),
      ]);
      setKpis(kpiRes.data);
      setRows(discRes.data);
      setCurrentRun(runRes.data);
    } catch (e) {
      toast.error("Failed to load run.");
    } finally {
      setLoadingRows(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const list = await loadRuns();
      const target = routeRunId || list?.[0]?.id;
      if (target) await loadRun(target);
      setBootstrapping(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeRunId]);

  const onCreated = async (run) => {
    await loadRuns();
    await loadRun(run.id);
  };

  const onExplain = (d) => {
    setSelected(d);
    setSheetOpen(true);
  };

  const onExplanationUpdated = (id, explanation) => {
    setRows((rs) =>
      rs.map((r) => (r.id === id ? { ...r, llm_explanation: explanation } : r))
    );
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-500">
            Reconciliation
          </div>
          <h1
            data-testid="dashboard-title"
            className="font-display text-3xl font-extrabold tracking-tight text-slate-900"
          >
            Order-Payment Ledger
          </h1>
          {currentRun && (
            <p className="mt-1 text-sm text-slate-600">
              Latest run:{" "}
              <span className="font-mono text-xs text-slate-800">
                {currentRun.orders_filename}
              </span>{" "}
              +{" "}
              <span className="font-mono text-xs text-slate-800">
                {currentRun.payments_filename}
              </span>{" "}
              · {new Date(currentRun.created_at).toLocaleString()}
              {currentRun.orders_skipped + currentRun.payments_skipped > 0 && (
                <span className="ml-2 rounded-md bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 text-[11px] font-semibold">
                  {currentRun.orders_skipped + currentRun.payments_skipped} row(s) skipped
                </span>
              )}
            </p>
          )}
        </div>
        {runs.length > 0 && (
          <Link
            to="/runs"
            data-testid="see-history-link"
            className="text-sm font-semibold text-slate-900 underline underline-offset-4 hover:text-slate-700"
          >
            View history ({runs.length} runs)
          </Link>
        )}
      </div>

      <UploadPanel onCreated={onCreated} />

      {bootstrapping ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-[112px]" />
          ))}
        </div>
      ) : !currentRun ? (
        <div
          data-testid="empty-state"
          className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center"
        >
          <h3 className="font-display text-lg font-bold text-slate-900">
            No runs yet
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Upload your first orders and payments CSV to see the reconciliation.
          </p>
        </div>
      ) : (
        <>
          <KpiCards kpis={kpis} />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <DiscrepancyChart kpis={kpis} />
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <h3 className="font-display text-lg font-bold text-slate-900">
                Money at risk by type
              </h3>
              <ul className="mt-3 space-y-2 text-sm">
                {Object.entries(kpis?.by_type_money || {})
                  .filter(([t]) => t !== "MATCHED")
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 6)
                  .map(([t, v]) => (
                    <li
                      key={t}
                      className="flex items-center justify-between border-b border-slate-100 pb-1.5 last:border-0"
                    >
                      <span className="text-slate-700">{t.replaceAll("_", " ")}</span>
                      <span className="tabular-nums font-semibold text-slate-900">
                        ${Number(v).toFixed(2)}
                      </span>
                    </li>
                  ))}
                {Object.keys(kpis?.by_type_money || {}).filter((t) => t !== "MATCHED").length === 0 && (
                  <li className="text-slate-500 text-sm">No money at risk.</li>
                )}
              </ul>
            </div>
          </div>
          <DiscrepancyTable rows={rows} loading={loadingRows} onExplain={onExplain} />
        </>
      )}

      <ExplainSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        discrepancy={selected}
        onUpdated={onExplanationUpdated}
      />
    </div>
  );
}

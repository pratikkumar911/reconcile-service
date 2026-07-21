import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "./ui/sheet";
import { Button } from "./ui/button";
import { Sparkles, RotateCw, AlertCircle } from "lucide-react";
import { SEVERITY, SEVERITY_CLASSES, TYPE_LABEL, fmtUsd } from "../lib/constants";

export default function ExplainSheet({ open, onOpenChange, discrepancy, onUpdated }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [explanation, setExplanation] = useState(null);

  const fetchExplain = async (regenerate = false) => {
    if (!discrepancy) return;
    setLoading(true);
    setError(null);
    try {
      const url = regenerate
        ? `/discrepancies/${discrepancy.id}/regenerate`
        : `/discrepancies/${discrepancy.id}/explain`;
      const { data } = await api.post(url);
      setExplanation(data.explanation);
      onUpdated?.(discrepancy.id, data.explanation);
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not fetch explanation.");
      toast.error("Explanation failed. You can retry.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && discrepancy) {
      if (discrepancy.llm_explanation) {
        setExplanation(discrepancy.llm_explanation);
        setError(null);
      } else {
        setExplanation(null);
        fetchExplain(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, discrepancy?.id]);

  if (!discrepancy) return null;
  const sev = SEVERITY[discrepancy.type] || "amber";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        data-testid="explain-sheet"
        side="right"
        className="w-full sm:w-[440px] md:w-[520px] bg-white overflow-y-auto"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="font-display flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5" />
            AI Explanation
          </SheetTitle>
          <SheetDescription>Plain-English breakdown for this discrepancy.</SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <span
                className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${SEVERITY_CLASSES[sev]}`}
              >
                {TYPE_LABEL[discrepancy.type] || discrepancy.type}
              </span>
              <span className="text-xs text-slate-500 font-mono">
                {discrepancy.currency || "USD"}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-slate-500">Order</dt>
              <dd className="font-mono text-xs text-slate-800" data-testid="explain-order-id">
                {discrepancy.order_id || "—"}
              </dd>
              <dt className="text-slate-500">Payment</dt>
              <dd className="font-mono text-xs text-slate-800" data-testid="explain-payment-id">
                {discrepancy.payment_id || "—"}
              </dd>
              <dt className="text-slate-500">Expected</dt>
              <dd className="tabular-nums">
                {discrepancy.expected_amount != null
                  ? discrepancy.expected_amount.toFixed(2)
                  : "—"}
              </dd>
              <dt className="text-slate-500">Actual</dt>
              <dd className="tabular-nums">
                {discrepancy.actual_amount != null
                  ? discrepancy.actual_amount.toFixed(2)
                  : "—"}
              </dd>
              <dt className="text-slate-500">Money at risk</dt>
              <dd className="tabular-nums font-semibold text-red-600">
                {fmtUsd(discrepancy.money_at_risk_usd || 0)}
              </dd>
            </dl>
          </div>

          {loading && (
            <div data-testid="explain-loading" className="space-y-3">
              <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200" />
              <div className="h-4 w-full animate-pulse rounded bg-slate-200" />
              <div className="h-4 w-5/6 animate-pulse rounded bg-slate-200" />
              <div className="h-4 w-4/6 animate-pulse rounded bg-slate-200" />
            </div>
          )}

          {error && !loading && (
            <div
              data-testid="explain-error"
              className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            >
              <AlertCircle className="h-5 w-5 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold">Couldn't fetch explanation</div>
                <div className="mt-1 text-red-600">{error}</div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  data-testid="explain-retry-btn"
                  onClick={() => fetchExplain(false)}
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  Retry
                </Button>
              </div>
            </div>
          )}

          {explanation && !loading && !error && (
            <div data-testid="explain-content" className="space-y-4">
              <section>
                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 mb-1">
                  Summary
                </div>
                <p className="text-sm text-slate-800 leading-relaxed">
                  {explanation.summary}
                </p>
              </section>
              <section>
                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 mb-1">
                  Likely cause
                </div>
                <p className="text-sm text-slate-700 leading-relaxed">
                  {explanation.likely_cause}
                </p>
              </section>
              <section>
                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 mb-1">
                  Suggested action
                </div>
                <p className="text-sm text-slate-800 leading-relaxed">
                  {explanation.suggested_action}
                </p>
              </section>
              <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  Generated by gemini · temperature 0.2
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="explain-regenerate-btn"
                  onClick={() => fetchExplain(true)}
                  className="gap-1"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  Regenerate
                </Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

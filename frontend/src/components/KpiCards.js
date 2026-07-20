import { fmtNum, fmtUsd } from "@/lib/constants";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

function Card({ label, value, sub, testid, accent }) {
  return (
    <div
      data-testid={testid}
      className={`rounded-lg border border-slate-200 bg-white p-5 transition-shadow hover:shadow-sm ${
        accent === "risk" ? "ring-1 ring-red-100" : ""
      }`}
    >
      <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div
        data-testid={`${testid}-value`}
        className={`mt-2 font-display font-black tabular-nums tracking-tighter ${
          accent === "risk" ? "text-red-600 text-3xl lg:text-4xl" : "text-slate-900 text-3xl lg:text-4xl"
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export default function KpiCards({ kpis }) {
  if (!kpis) return null;
  return (
    <TooltipProvider>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Card
          testid="kpi-total-orders"
          label="Total Orders"
          value={fmtNum(kpis.total_orders)}
        />
        <Card
          testid="kpi-total-payments"
          label="Total Payments"
          value={fmtNum(kpis.total_payments)}
        />
        <Card
          testid="kpi-reconciled"
          label="Reconciled"
          value={fmtNum(kpis.total_reconciled)}
          sub={`${kpis.total_orders ? Math.round((kpis.total_reconciled / kpis.total_orders) * 100) : 0}% of orders`}
        />
        <Card
          testid="kpi-discrepancies"
          label="Discrepancies"
          value={fmtNum(kpis.total_discrepancies)}
        />
        <div
          data-testid="kpi-money-at-risk"
          className="rounded-lg border border-slate-200 bg-white p-5 ring-1 ring-red-100"
        >
          <div className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
            Money at risk
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-slate-400 hover:text-slate-700" aria-label="fx-info">
                  <Info className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                EUR converted to USD at fixed rate {kpis.fx_rate_eur_to_usd}
              </TooltipContent>
            </Tooltip>
          </div>
          <div
            data-testid="kpi-money-at-risk-value"
            className="mt-2 font-display text-3xl lg:text-4xl font-black text-red-600 tabular-nums tracking-tighter"
          >
            {fmtUsd(kpis.total_money_at_risk_usd)}
          </div>
          <div className="mt-1 text-xs text-slate-500">Absolute impact across all discrepancies</div>
        </div>
      </div>
    </TooltipProvider>
  );
}

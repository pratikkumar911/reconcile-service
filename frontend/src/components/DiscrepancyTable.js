import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles, Filter, Search, ChevronDown } from "lucide-react";
import { DISCREPANCY_TYPES, SEVERITY, SEVERITY_CLASSES, TYPE_LABEL, fmtUsd } from "@/lib/constants";

export default function DiscrepancyTable({ rows, loading, onExplain }) {
  const [typeFilter, setTypeFilter] = useState(new Set()); // empty = all
  const [currency, setCurrency] = useState("all");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    return (rows || []).filter((d) => {
      if (typeFilter.size > 0 && !typeFilter.has(d.type)) return false;
      if (currency !== "all" && (d.currency || "").toUpperCase() !== currency) return false;
      if (q) {
        const s = q.toLowerCase();
        if (
          !(d.order_id || "").toLowerCase().includes(s) &&
          !(d.payment_id || "").toLowerCase().includes(s)
        )
          return false;
      }
      return true;
    });
  }, [rows, typeFilter, currency, q]);

  const toggleType = (t) => {
    const next = new Set(typeFilter);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setTypeFilter(next);
  };

  const clearFilters = () => {
    setTypeFilter(new Set());
    setCurrency("all");
    setQ("");
  };

  return (
    <div
      data-testid="discrepancy-table-panel"
      className="rounded-lg border border-slate-200 bg-white"
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
        <h3 className="font-display text-lg font-bold text-slate-900 mr-auto">
          Discrepancies
          <span className="ml-2 font-mono text-xs font-medium text-slate-500 tabular-nums">
            {filtered.length}
          </span>
        </h3>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            data-testid="search-input"
            placeholder="Search order_id / payment_id"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-64 pl-8"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              data-testid="type-filter-btn"
              className="gap-1.5"
            >
              <Filter className="h-4 w-4" />
              Type
              {typeFilter.size > 0 && (
                <Badge className="ml-1 h-5 px-1.5 bg-slate-900 text-white">
                  {typeFilter.size}
                </Badge>
              )}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-white">
            <DropdownMenuLabel>Filter by type</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {DISCREPANCY_TYPES.filter((t) => t !== "MATCHED").map((t) => (
              <DropdownMenuCheckboxItem
                key={t}
                data-testid={`type-filter-${t}`}
                checked={typeFilter.has(t)}
                onCheckedChange={() => toggleType(t)}
              >
                {TYPE_LABEL[t]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Select value={currency} onValueChange={setCurrency}>
          <SelectTrigger
            data-testid="currency-filter"
            className="h-9 w-[120px]"
          >
            <SelectValue placeholder="Currency" />
          </SelectTrigger>
          <SelectContent className="bg-white">
            <SelectItem value="all">All currencies</SelectItem>
            <SelectItem value="USD">USD</SelectItem>
            <SelectItem value="EUR">EUR</SelectItem>
          </SelectContent>
        </Select>

        {(typeFilter.size > 0 || currency !== "all" || q) && (
          <Button
            variant="ghost"
            size="sm"
            data-testid="clear-filters-btn"
            onClick={clearFilters}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="thin-scroll w-full overflow-x-auto">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead className="w-[180px]">Type</TableHead>
              <TableHead>Order ID</TableHead>
              <TableHead>Payment ID</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead className="text-right">Money at risk (USD)</TableHead>
              <TableHead className="w-[100px] text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={8}>
                    <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                  </TableCell>
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-slate-500">
                  No discrepancies match these filters.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((d) => (
                <TableRow
                  key={d.id}
                  data-testid={`discrepancy-row-${d.id}`}
                  className="hover:bg-slate-50"
                >
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                        SEVERITY_CLASSES[SEVERITY[d.type] || "amber"]
                      }`}
                    >
                      {TYPE_LABEL[d.type] || d.type}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{d.order_id || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{d.payment_id || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {d.expected_amount != null ? d.expected_amount.toFixed(2) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {d.actual_amount != null ? d.actual_amount.toFixed(2) : "—"}
                  </TableCell>
                  <TableCell>{d.currency || "—"}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-slate-900">
                    {fmtUsd(d.money_at_risk_usd || 0)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`explain-btn-${d.id}`}
                      onClick={() => onExplain(d)}
                      className="gap-1"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Explain
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

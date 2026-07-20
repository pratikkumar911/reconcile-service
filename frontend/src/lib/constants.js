export const DISCREPANCY_TYPES = [
  "MATCHED",
  "MISSING_PAYMENT",
  "AMOUNT_MISMATCH",
  "CURRENCY_MISMATCH",
  "DUPLICATE_PAYMENT",
  "ORPHAN_PAYMENT",
  "CANCELLED_BUT_PAID",
  "REFUND_MISMATCH",
  "STATUS_CONFLICT",
];

// Severity mapping per design guidelines
export const SEVERITY = {
  MATCHED: "green",
  AMOUNT_MISMATCH: "amber",
  CURRENCY_MISMATCH: "amber",
  ORPHAN_PAYMENT: "amber",
  REFUND_MISMATCH: "amber",
  MISSING_PAYMENT: "red",
  STATUS_CONFLICT: "red",
  DUPLICATE_PAYMENT: "red",
  CANCELLED_BUT_PAID: "red",
};

export const SEVERITY_CLASSES = {
  red: "bg-red-50 text-red-700 border border-red-200",
  amber: "bg-amber-50 text-amber-700 border border-amber-200",
  green: "bg-emerald-50 text-emerald-700 border border-emerald-200",
};

// Recharts colors (must be actual hex, not classes)
export const SEVERITY_HEX = {
  red: "#dc2626",
  amber: "#d97706",
  green: "#059669",
};

export const TYPE_LABEL = {
  MATCHED: "Matched",
  MISSING_PAYMENT: "Missing Payment",
  AMOUNT_MISMATCH: "Amount Mismatch",
  CURRENCY_MISMATCH: "Currency Mismatch",
  DUPLICATE_PAYMENT: "Duplicate Payment",
  ORPHAN_PAYMENT: "Orphan Payment",
  CANCELLED_BUT_PAID: "Cancelled But Paid",
  REFUND_MISMATCH: "Refund Mismatch",
  STATUS_CONFLICT: "Status Conflict",
};

export const fmtUsd = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);

export const fmtNum = (n) =>
  new Intl.NumberFormat("en-US").format(n || 0);

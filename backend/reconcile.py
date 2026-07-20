"""Deterministic reconciliation engine.

Match orders to payments by order_id. Classifies each order into a discrepancy
type per assignment rules. Also produces ORPHAN_PAYMENT rows.
"""
from __future__ import annotations

from typing import List, Dict, Any, Tuple
from collections import defaultdict
import uuid
from datetime import datetime, timezone

FX_EUR_TO_USD = 1.08


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_usd(amount: float, currency: str) -> float:
    if currency and currency.upper() == "EUR":
        return round(amount * FX_EUR_TO_USD, 2)
    return round(amount, 2)


def _within_tolerance(net: float, paid: float) -> bool:
    diff = abs(paid - net)
    tol = max(0.02, abs(net) * 0.005)
    return diff <= tol


def reconcile(
    orders: List[Dict[str, Any]],
    payments: List[Dict[str, Any]],
    run_id: str,
    user_id: str,
) -> List[Dict[str, Any]]:
    """Run the reconciliation. Returns list of discrepancy documents."""

    # Group payments by order_id
    payments_by_order: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for p in payments:
        oid = (p.get("order_id") or "").strip()
        if oid:
            payments_by_order[oid].append(p)

    # Dedup orders by order_id: keep first, but flag duplicates via ORPHAN? We'll skip duplicate orders for classification (assignment says possibly duplicate order_ids).
    seen_order_ids = set()
    unique_orders: List[Dict[str, Any]] = []
    duplicate_orders: List[Dict[str, Any]] = []
    for o in orders:
        oid = (o.get("order_id") or "").strip()
        if oid in seen_order_ids:
            duplicate_orders.append(o)
        else:
            seen_order_ids.add(oid)
            unique_orders.append(o)

    order_ids = set(seen_order_ids)
    discrepancies: List[Dict[str, Any]] = []

    def _mk(
        type_: str,
        order: Dict[str, Any] | None,
        payment: Dict[str, Any] | None,
        expected: float | None,
        actual: float | None,
        currency: str | None,
        money_at_risk: float,
        details: Dict[str, Any],
    ) -> Dict[str, Any]:
        return {
            "id": str(uuid.uuid4()),
            "run_id": run_id,
            "user_id": user_id,
            "type": type_,
            "order_id": (order.get("order_id") if order else (payment.get("order_id") if payment else None)),
            "payment_id": payment.get("payment_id") if payment else None,
            "expected_amount": expected,
            "actual_amount": actual,
            "currency": currency,
            "money_at_risk": round(money_at_risk, 2),
            "money_at_risk_usd": _to_usd(money_at_risk, currency or "USD"),
            "details_json": details,
            "llm_explanation": None,
            "created_at": _now_iso(),
        }

    # Iterate orders
    for order in unique_orders:
        oid = (order.get("order_id") or "").strip()
        status_ = (order.get("status") or "").lower()
        net = float(order.get("net_amount") or 0.0)
        currency = (order.get("currency") or "USD").upper()

        related = payments_by_order.get(oid, [])
        succeeded = [p for p in related if (p.get("status") or "").lower() == "succeeded"]
        non_succeeded = [p for p in related if (p.get("status") or "").lower() != "succeeded"]

        # DUPLICATE_PAYMENT: >1 succeeded for same order
        if len(succeeded) > 1:
            total_paid = sum(float(p.get("paid_amount") or 0.0) for p in succeeded)
            discrepancies.append(_mk(
                "DUPLICATE_PAYMENT",
                order,
                succeeded[0],
                net,
                total_paid,
                currency,
                money_at_risk=abs(total_paid - net),
                details={
                    "duplicate_count": len(succeeded),
                    "payment_ids": [p.get("payment_id") for p in succeeded],
                    "amounts": [float(p.get("paid_amount") or 0.0) for p in succeeded],
                    "order_status": status_,
                },
            ))
            continue

        # CANCELLED_BUT_PAID: order cancelled but has succeeded payment
        if status_ == "cancelled" and len(succeeded) >= 1:
            p = succeeded[0]
            paid = float(p.get("paid_amount") or 0.0)
            discrepancies.append(_mk(
                "CANCELLED_BUT_PAID",
                order,
                p,
                0.0,
                paid,
                currency,
                money_at_risk=abs(paid),
                details={"order_status": status_, "payment_status": (p.get("status") or "").lower()},
            ))
            continue

        # REFUND_MISMATCH: refunded order but no refund payment (or amount mismatch)
        if status_ == "refunded":
            refunds = [
                p for p in related
                if (p.get("status") or "").lower() == "refunded"
                or float(p.get("paid_amount") or 0.0) < 0
            ]
            if not refunds:
                discrepancies.append(_mk(
                    "REFUND_MISMATCH",
                    order,
                    None,
                    -net,
                    0.0,
                    currency,
                    money_at_risk=abs(net),
                    details={"reason": "Order refunded but no refund payment found"},
                ))
                continue
            total_refund = sum(abs(float(p.get("paid_amount") or 0.0)) for p in refunds)
            if not _within_tolerance(net, total_refund):
                discrepancies.append(_mk(
                    "REFUND_MISMATCH",
                    order,
                    refunds[0],
                    -net,
                    -total_refund,
                    currency,
                    money_at_risk=abs(net - total_refund),
                    details={
                        "reason": "Refund amount does not match order net_amount",
                        "refund_amount": total_refund,
                    },
                ))
                continue
            # else: refunded and matches — treat as matched
            discrepancies.append(_mk(
                "MATCHED",
                order,
                refunds[0],
                -net,
                -total_refund,
                currency,
                money_at_risk=0.0,
                details={"note": "Order refunded and refund payment matches"},
            ))
            continue

        # MISSING_PAYMENT: order completed but no payment row at all
        if status_ == "completed" and len(related) == 0:
            discrepancies.append(_mk(
                "MISSING_PAYMENT",
                order,
                None,
                net,
                0.0,
                currency,
                money_at_risk=abs(net),
                details={"order_status": status_},
            ))
            continue

        # STATUS_CONFLICT: order completed but payment status failed/pending (and no succeeded)
        if status_ == "completed" and len(succeeded) == 0 and len(non_succeeded) > 0:
            p = non_succeeded[0]
            discrepancies.append(_mk(
                "STATUS_CONFLICT",
                order,
                p,
                net,
                float(p.get("paid_amount") or 0.0),
                currency,
                money_at_risk=abs(net),
                details={
                    "order_status": status_,
                    "payment_status": (p.get("status") or "").lower(),
                },
            ))
            continue

        # There is exactly one succeeded payment (or zero for non-completed orders)
        if len(succeeded) == 1:
            p = succeeded[0]
            paid = float(p.get("paid_amount") or 0.0)
            pay_currency = (p.get("currency") or "USD").upper()
            if pay_currency != currency:
                discrepancies.append(_mk(
                    "CURRENCY_MISMATCH",
                    order,
                    p,
                    net,
                    paid,
                    currency,
                    money_at_risk=abs(net),
                    details={"order_currency": currency, "payment_currency": pay_currency},
                ))
                continue
            if not _within_tolerance(net, paid):
                discrepancies.append(_mk(
                    "AMOUNT_MISMATCH",
                    order,
                    p,
                    net,
                    paid,
                    currency,
                    money_at_risk=abs(net - paid),
                    details={"tolerance": max(0.02, abs(net) * 0.005)},
                ))
                continue
            # MATCHED
            discrepancies.append(_mk(
                "MATCHED",
                order,
                p,
                net,
                paid,
                currency,
                money_at_risk=0.0,
                details={"order_status": status_},
            ))
            continue

        # Fallback: non-completed order with no succeeded payment → treat as MATCHED (nothing to reconcile)
        discrepancies.append(_mk(
            "MATCHED",
            order,
            None,
            net,
            0.0,
            currency,
            money_at_risk=0.0,
            details={"order_status": status_, "note": "Non-completed order without payment"},
        ))

    # Handle duplicate order rows
    for dup in duplicate_orders:
        discrepancies.append(_mk(
            "DUPLICATE_PAYMENT",
            dup,
            None,
            float(dup.get("net_amount") or 0.0),
            None,
            (dup.get("currency") or "USD").upper(),
            money_at_risk=abs(float(dup.get("net_amount") or 0.0)),
            details={"reason": "Duplicate order_id in uploaded orders.csv"},
        ))

    # ORPHAN_PAYMENT: payments whose order_id is not in orders
    for p in payments:
        oid = (p.get("order_id") or "").strip()
        if not oid or oid not in order_ids:
            paid = float(p.get("paid_amount") or 0.0)
            currency = (p.get("currency") or "USD").upper()
            discrepancies.append(_mk(
                "ORPHAN_PAYMENT",
                None,
                p,
                None,
                paid,
                currency,
                money_at_risk=abs(paid),
                details={"payment_status": (p.get("status") or "").lower(), "order_id_from_payment": oid or None},
            ))

    return discrepancies

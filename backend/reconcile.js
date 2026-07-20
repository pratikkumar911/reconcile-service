const FX_EUR_TO_USD = 1.08;

function _nowIso() {
  return new Date().toISOString();
}

function _toUsd(amount, currency) {
  if (currency && currency.toUpperCase() === 'EUR') {
    return round2(amount * FX_EUR_TO_USD);
  }
  return round2(amount);
}

function _withinTolerance(net, paid) {
  const diff = Math.abs(paid - net);
  const tol = Math.max(0.02, Math.abs(net) * 0.005);
  return diff <= tol;
}

function reconcile(orders, payments, runId, userId) {
  const paymentsByOrder = new Map();
  for (const p of payments) {
    const oid = String(p.order_id || '').trim();
    if (oid) {
      if (!paymentsByOrder.has(oid)) paymentsByOrder.set(oid, []);
      paymentsByOrder.get(oid).push(p);
    }
  }

  const seenOrderIds = new Set();
  const uniqueOrders = [];
  const duplicateOrders = [];
  for (const o of orders) {
    const oid = String(o.order_id || '').trim();
    if (seenOrderIds.has(oid)) {
      duplicateOrders.push(o);
    } else {
      seenOrderIds.add(oid);
      uniqueOrders.push(o);
    }
  }

  const orderIds = new Set(seenOrderIds);
  const discrepancies = [];

  const mk = (type_, order, payment, expected, actual, currency, moneyAtRisk, details) => ({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    run_id: runId,
    user_id: userId,
    type: type_,
    order_id: order ? order.order_id : payment ? payment.order_id : null,
    payment_id: payment ? payment.payment_id : null,
    expected_amount: expected,
    actual_amount: actual,
    currency,
    money_at_risk: round2(moneyAtRisk),
    money_at_risk_usd: _toUsd(moneyAtRisk, currency || 'USD'),
    details_json: details,
    llm_explanation: null,
    created_at: _nowIso(),
  });

  for (const order of uniqueOrders) {
    const oid = String(order.order_id || '').trim();
    const status_ = String(order.status || '').toLowerCase();
    const net = Number(order.net_amount || 0.0);
    const currency = String(order.currency || 'USD').toUpperCase();
    const related = paymentsByOrder.get(oid) || [];
    const succeeded = related.filter((p) => String(p.status || '').toLowerCase() === 'succeeded');
    const nonSucceeded = related.filter((p) => String(p.status || '').toLowerCase() !== 'succeeded');

    if (succeeded.length > 1) {
      const totalPaid = succeeded.reduce((sum, p) => sum + Number(p.paid_amount || 0.0), 0);
      discrepancies.push(mk('DUPLICATE_PAYMENT', order, succeeded[0], net, totalPaid, currency, Math.abs(totalPaid - net), {
        duplicate_count: succeeded.length,
        payment_ids: succeeded.map((p) => p.payment_id),
        amounts: succeeded.map((p) => Number(p.paid_amount || 0.0)),
        order_status: status_,
      }));
      continue;
    }

    if (status_ === 'cancelled' && succeeded.length >= 1) {
      const p = succeeded[0];
      const paid = Number(p.paid_amount || 0.0);
      discrepancies.push(mk('CANCELLED_BUT_PAID', order, p, 0.0, paid, currency, Math.abs(paid), { order_status: status_, payment_status: String(p.status || '').toLowerCase() }));
      continue;
    }

    if (status_ === 'refunded') {
      const refunds = related.filter((p) => String(p.status || '').toLowerCase() === 'refunded' || Number(p.paid_amount || 0.0) < 0);
      if (!refunds.length) {
        discrepancies.push(mk('REFUND_MISMATCH', order, null, -net, 0.0, currency, Math.abs(net), { reason: 'Order refunded but no refund payment found' }));
        continue;
      }
      const totalRefund = refunds.reduce((sum, p) => sum + Math.abs(Number(p.paid_amount || 0.0)), 0);
      if (!_withinTolerance(net, totalRefund)) {
        discrepancies.push(mk('REFUND_MISMATCH', order, refunds[0], -net, -totalRefund, currency, Math.abs(net - totalRefund), { reason: 'Refund amount does not match order net_amount', refund_amount: totalRefund }));
        continue;
      }
      discrepancies.push(mk('MATCHED', order, refunds[0], -net, -totalRefund, currency, 0.0, { note: 'Order refunded and refund payment matches' }));
      continue;
    }

    if (status_ === 'completed' && related.length === 0) {
      discrepancies.push(mk('MISSING_PAYMENT', order, null, net, 0.0, currency, Math.abs(net), { order_status: status_ }));
      continue;
    }

    if (status_ === 'completed' && succeeded.length === 0 && nonSucceeded.length > 0) {
      const p = nonSucceeded[0];
      discrepancies.push(mk('STATUS_CONFLICT', order, p, net, Number(p.paid_amount || 0.0), currency, Math.abs(net), { order_status: status_, payment_status: String(p.status || '').toLowerCase() }));
      continue;
    }

    if (succeeded.length === 1) {
      const p = succeeded[0];
      const paid = Number(p.paid_amount || 0.0);
      const payCurrency = String(p.currency || 'USD').toUpperCase();
      if (payCurrency !== currency) {
        discrepancies.push(mk('CURRENCY_MISMATCH', order, p, net, paid, currency, Math.abs(net), { order_currency: currency, payment_currency: payCurrency }));
        continue;
      }
      if (!_withinTolerance(net, paid)) {
        discrepancies.push(mk('AMOUNT_MISMATCH', order, p, net, paid, currency, Math.abs(net - paid), { tolerance: Math.max(0.02, Math.abs(net) * 0.005) }));
        continue;
      }
      discrepancies.push(mk('MATCHED', order, p, net, paid, currency, 0.0, { order_status: status_ }));
      continue;
    }

    discrepancies.push(mk('MATCHED', order, null, net, 0.0, currency, 0.0, { order_status: status_, note: 'Non-completed order without payment' }));
  }

  for (const dup of duplicateOrders) {
    discrepancies.push(mk('DUPLICATE_PAYMENT', dup, null, Number(dup.net_amount || 0.0), null, String(dup.currency || 'USD').toUpperCase(), Math.abs(Number(dup.net_amount || 0.0)), { reason: 'Duplicate order_id in uploaded orders.csv' }));
  }

  for (const p of payments) {
    const oid = String(p.order_id || '').trim();
    if (!oid || !orderIds.has(oid)) {
      const paid = Number(p.paid_amount || 0.0);
      const currency = String(p.currency || 'USD').toUpperCase();
      discrepancies.push(mk('ORPHAN_PAYMENT', null, p, null, paid, currency, Math.abs(paid), { payment_status: String(p.status || '').toLowerCase(), order_id_from_payment: oid || null }));
    }
  }

  return discrepancies;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

module.exports = { reconcile, FX_EUR_TO_USD, _toUsd };

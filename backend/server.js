const express = require('express');
const cors = require('cors');
const multer = require('multer');
const dotenv = require('dotenv');
const path = require('path');
const { MongoClient } = require('mongodb');
const { reconcile, FX_EUR_TO_USD, _to_usd } = require('./reconcile');
const { hashPassword, verifyPassword, createToken, authenticate } = require('./auth');
const { explainDiscrepancy } = require('./llm');
const { createUserPublic, createAuthResponse, createDiscrepancyOut, createKpiSummary } = require('./models');

const dns = require('node:dns');
dns.setServers(['1.1.1.1', '8.8.8.8']);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const port = process.env.PORT || 8000;

const mongoUrl = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017';
const jwtSecret = process.env.JWT_SECRET || 'dev-secret';

const client = new MongoClient(mongoUrl);
let db;

async function connectDb() {
  try {
    if (!db) {
      await client.connect();
      db = client.db();
    }
    return db;
  } catch (error) {
    console.error('Database connection failed:', error);
    throw error;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function parseFloatValue(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().replace(/,/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  const formats = [
    /^\d{4}-\d{2}-\d{2}$/,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/,
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/,
    /^\d{2}\/\d{2}\/\d{4}$/,
    /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/,
    /^\d{2}\/\d{2}\/\d{4}$/,
    /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/,
    /^\d{2}-\d{2}-\d{4}$/,
  ];
  for (const fmt of formats) {
    if (fmt.test(s)) {
      const date = new Date(s);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
  }
  return s;
}

function normalizePaymentStatus(status, method, amount) {
  const s = (status || '').trim().toLowerCase();
  const m = (method || '').trim().toLowerCase();
  let signed = amount;
  if (m === 'refund' || m === 'refunded' || m === 'reversal') {
    return { status: 'refunded', amount: -Math.abs(amount) };
  }
  if (['refunded', 'refund', 'reversed', 'chargeback'].includes(s)) {
    return { status: 'refunded', amount: signed > 0 ? -Math.abs(amount) : signed };
  }
  if (['succeeded', 'success', 'successful', 'settled', 'captured', 'paid', 'completed', 'complete'].includes(s)) {
    return { status: 'succeeded', amount: signed };
  }
  if (['failed', 'fail', 'declined', 'error'].includes(s)) {
    return { status: 'failed', amount: signed };
  }
  if (['pending', 'processing', 'authorizing', 'requires_action'].includes(s)) {
    return { status: 'pending', amount: signed };
  }
  return { status: s || 'unknown', amount: signed };
}

function resolveAliases(row, aliasMap) {
  const lowerRow = Object.fromEntries(Object.entries(row).map(([k, v]) => [(k || '').trim().toLowerCase(), v]));
  const out = {};
  for (const [canonical, options] of Object.entries(aliasMap)) {
    for (const opt of options) {
      if (opt.toLowerCase() in lowerRow && lowerRow[opt.toLowerCase()] !== null && lowerRow[opt.toLowerCase()] !== '') {
        out[canonical] = lowerRow[opt.toLowerCase()];
        break;
      }
    }
  }
  return out;
}

function missingCanonicalHeaders(headers, aliasMap, required) {
  const headersLower = new Set([...headers].map((h) => (h || '').trim().toLowerCase()));
  const missing = [];
  for (const canonical of required) {
    const options = aliasMap[canonical] || [canonical];
    if (!options.some((opt) => headersLower.has(opt.toLowerCase()))) {
      missing.push(canonical);
    }
  }
  return missing.sort();
}

function readCsvRows(buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows = [];
  for (const line of lines.slice(1)) {
    const values = line.split(',');
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ? values[index].trim() : '';
    });
    rows.push(row);
  }
  return rows;
}

function normalizeOrders(rows) {
  const out = [];
  const skipped = [];
  rows.forEach((r, index) => {
    const row = resolveAliases(r, ORDERS_ALIASES);
    const oid = (row.order_id || '').trim();
    if (!oid) {
      skipped.push(`orders row ${index + 2}: missing order_id`);
      return;
    }
    let net = parseFloatValue(row.net_amount);
    let gross = parseFloatValue(row.gross_amount);
    const discount = parseFloatValue(row.discount);
    if (net === null && gross !== null) {
      net = round2((gross || 0.0) - (discount || 0.0));
    }
    if (net === null) {
      skipped.push(`orders row ${index + 2}: missing net_amount`);
      return;
    }
    const email = ((row.customer_email || '').trim().toLowerCase() || null);
    const currency = ((row.currency || 'USD').trim().toUpperCase());
    let status = (row.status || '').trim().toLowerCase();
    if (['succeeded', 'success', 'successful', 'settled', 'captured', 'paid', 'completed', 'complete'].includes(status)) {
      status = 'completed';
    } else if (['cancelled', 'canceled', 'void', 'voided'].includes(status)) {
      status = 'cancelled';
    } else if (['refunded', 'refund', 'reversed', 'chargeback'].includes(status)) {
      status = 'refunded';
    }
    out.push({
      order_id: oid,
      customer_email: email,
      order_date: parseDate(row.order_date),
      gross_amount: gross !== null ? round2(gross) : null,
      discount: discount !== null ? round2(discount) : 0.0,
      net_amount: round2(net),
      currency,
      status,
    });
  });
  return { rows: out, skipped };
}

function normalizePayments(rows) {
  const out = [];
  const skipped = [];
  rows.forEach((r, index) => {
    const row = resolveAliases(r, PAYMENTS_ALIASES);
    const pid = (row.payment_id || '').trim();
    const oid = (row.order_id || '').trim();
    if (!pid) {
      skipped.push(`payments row ${index + 2}: missing payment_id`);
      return;
    }
    const amount = parseFloatValue(row.paid_amount);
    if (amount === null) {
      skipped.push(`payments row ${index + 2}: missing paid_amount`);
      return;
    }
    const rawMethod = (row.method || '').trim().toLowerCase() || null;
    const rawStatus = (row.status || '').trim().toLowerCase();
    const { status, amount: signedAmount } = normalizePaymentStatus(rawStatus, rawMethod || '', amount);
    out.push({
      payment_id: pid,
      order_id: oid || null,
      paid_amount: round2(signedAmount),
      currency: ((row.currency || 'USD').trim().toUpperCase()),
      payment_date: parseDate(row.payment_date),
      method: rawMethod,
      status,
    });
  });
  return { rows: out, skipped };
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

app.use(cors());
app.use(express.json());
app.use('/api', express.json());

app.post('/api/auth/signup', async (req, res) => {
  try {
    await connectDb();
    const email = String(req.body.email || '').trim().toLowerCase();
    const existing = await db.collection('users').findOne({ email });
    if (existing) return res.status(400).json({ detail: 'Email already registered' });
    const userId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const createdAt = nowIso();
    await db.collection('users').insertOne({ id: userId, email, password_hash: hashPassword(req.body.password), created_at: createdAt });
    const token = createToken(userId, email);
    return res.json(createAuthResponse(token, createUserPublic(userId, email, createdAt)));
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    await connectDb();
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = await db.collection('users').findOne({ email });
    if (!user || !verifyPassword(req.body.password, user.password_hash)) {
      return res.status(401).json({ detail: 'Invalid credentials' });
    }
    const token = createToken(user.id, user.email);
    return res.json(createAuthResponse(token, createUserPublic(user.id, user.email, user.created_at)));
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

app.get('/api/auth/me', authenticate, async (req, res) => {
  try {
    await connectDb();
    const user = await db.collection('users').findOne({ id: req.user.id }, { projection: { password_hash: 0, _id: 0 } });
    if (!user) return res.status(404).json({ detail: 'User not found' });
    return res.json(user);
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

const ORDERS_HEADERS = new Set(['order_id', 'customer_email', 'order_date', 'gross_amount', 'discount', 'net_amount', 'currency', 'status']);
const PAYMENTS_HEADERS = new Set(['payment_id', 'order_id', 'paid_amount', 'currency', 'payment_date', 'method', 'status']);
const ORDERS_ALIASES = {
  order_id: ['order_id', 'order_reference', 'orderid', 'order id', 'id'],
  customer_email: ['customer_email', 'email', 'customer', 'buyer_email'],
  order_date: ['order_date', 'created_at', 'date', 'placed_at'],
  gross_amount: ['gross_amount', 'gross', 'subtotal', 'amount'],
  discount: ['discount', 'discount_amount'],
  net_amount: ['net_amount', 'net', 'total', 'grand_total'],
  currency: ['currency', 'curr'],
  status: ['status', 'order_status', 'state'],
};
const PAYMENTS_ALIASES = {
  payment_id: ['payment_id', 'transaction_ref', 'transaction_id', 'txn_id', 'reference'],
  order_id: ['order_id', 'order_reference', 'order_ref'],
  paid_amount: ['paid_amount', 'amount', 'amount_paid', 'gross_amount', 'captured_amount'],
  currency: ['currency', 'curr'],
  payment_date: ['payment_date', 'processed_at', 'created_at', 'date', 'captured_at'],
  method: ['method', 'type', 'payment_method', 'channel'],
  status: ['status', 'payment_status', 'state'],
};

app.post('/api/runs', authenticate, upload.fields([{ name: 'orders_file' }, { name: 'payments_file' }]), async (req, res) => {
  try {
    await connectDb();
    const ordersFile = req.files?.orders_file?.[0];
    const paymentsFile = req.files?.payments_file?.[0];
    if (!ordersFile || !paymentsFile) return res.status(400).json({ detail: 'Both files are required' });
    const maxUploadMb = 5;
    if (!String(ordersFile.originalname || '').toLowerCase().endsWith('.csv')) return res.status(400).json({ detail: `${ordersFile.originalname}: expected .csv file` });
    if (!String(paymentsFile.originalname || '').toLowerCase().endsWith('.csv')) return res.status(400).json({ detail: `${paymentsFile.originalname}: expected .csv file` });
    if (ordersFile.buffer.length > maxUploadMb * 1024 * 1024) return res.status(400).json({ detail: `${ordersFile.originalname}: file too large (>5MB)` });
    if (paymentsFile.buffer.length > maxUploadMb * 1024 * 1024) return res.status(400).json({ detail: `${paymentsFile.originalname}: file too large (>5MB)` });

    const ordersRows = readCsvRows(ordersFile.buffer);
    const paymentsRows = readCsvRows(paymentsFile.buffer);
    if (!ordersRows.length) return res.status(400).json({ detail: 'orders.csv is empty or unreadable' });
    if (!paymentsRows.length) return res.status(400).json({ detail: 'payments.csv is empty or unreadable' });

    const ordersHeaders = new Set(Object.keys(ordersRows[0]));
    const paymentsHeaders = new Set(Object.keys(paymentsRows[0]));
    const missingOrders = missingCanonicalHeaders(ordersHeaders, ORDERS_ALIASES, [...ORDERS_HEADERS]);
    const missingPayments = missingCanonicalHeaders(paymentsHeaders, PAYMENTS_ALIASES, [...PAYMENTS_HEADERS]);
    if (missingOrders.length) return res.status(400).json({ detail: `orders.csv missing headers: ${missingOrders.join(', ')}` });
    if (missingPayments.length) return res.status(400).json({ detail: `payments.csv missing headers: ${missingPayments.join(', ')}` });

    const ordersNorm = normalizeOrders(ordersRows);
    const paymentsNorm = normalizePayments(paymentsRows);
    const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const userId = req.user.id;

    const ordersDocs = ordersNorm.rows.map((o) => ({ ...o, _pk: `${Date.now()}-${Math.random().toString(16).slice(2)}`, user_id: userId, run_id: runId }));
    const paymentsDocs = paymentsNorm.rows.map((p) => ({ ...p, _pk: `${Date.now()}-${Math.random().toString(16).slice(2)}`, user_id: userId, run_id: runId }));

    if (ordersDocs.length) await db.collection('orders').insertMany(ordersDocs);
    if (paymentsDocs.length) await db.collection('payments').insertMany(paymentsDocs);

    const discrepancies = reconcile(ordersDocs, paymentsDocs, runId, userId);
    if (discrepancies.length) await db.collection('discrepancies').insertMany(discrepancies);

    const counts = Object.values(discrepancies.reduce((acc, d) => { acc[d.type] = (acc[d.type] || 0) + 1; return acc; }, {}));
    const totalRisk = round2(discrepancies.filter((d) => d.type !== 'MATCHED').reduce((sum, d) => sum + (d.money_at_risk_usd || 0), 0));
    const runDoc = {
      id: runId,
      user_id: userId,
      orders_filename: ordersFile.originalname || 'orders.csv',
      payments_filename: paymentsFile.originalname || 'payments.csv',
      orders_count: ordersDocs.length,
      payments_count: paymentsDocs.length,
      orders_skipped: ordersNorm.skipped.length,
      payments_skipped: paymentsNorm.skipped.length,
      skipped_reasons: [...ordersNorm.skipped, ...paymentsNorm.skipped].slice(0, 50),
      total_money_at_risk_usd: totalRisk,
      discrepancy_counts: Object.entries(discrepancies.reduce((acc, d) => { acc[d.type] = (acc[d.type] || 0) + 1; return acc; }, {})).reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
      created_at: nowIso(),
    };
    await db.collection('runs').insertOne(runDoc);
    return res.json(runDoc);
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

app.get('/api/runs/:runId', authenticate, async (req, res) => {
  try {
    await connectDb();
    const run = await db.collection('runs').findOne({ id: req.params.runId, user_id: req.user.id }, { projection: { _id: 0 } });
    if (!run) return res.status(404).json({ detail: 'Run not found' });
    return res.json(run);
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

app.get('/api/runs/:runId/kpis', authenticate, async (req, res) => {
  try {
    await connectDb();
    const run = await db.collection('runs').findOne({ id: req.params.runId, user_id: req.user.id });
    if (!run) return res.status(404).json({ detail: 'Run not found' });
    const [ordersCount, paymentsCount, discrepancies] = await Promise.all([
      db.collection('orders').countDocuments({ run_id: req.params.runId, user_id: req.user.id }),
      db.collection('payments').countDocuments({ run_id: req.params.runId, user_id: req.user.id }),
      db.collection('discrepancies').find({ run_id: req.params.runId, user_id: req.user.id }).toArray(),
    ]);
    const byType = {};
    const byTypeMoney = {};
    let totalRiskUsd = 0;
    let matched = 0;
    let discreps = 0;
    for (const d of discrepancies) {
      if (d.type === 'MATCHED') matched += 1; else discreps += 1;
      byType[d.type] = (byType[d.type] || 0) + 1;
      byTypeMoney[d.type] = (byTypeMoney[d.type] || 0) + (d.money_at_risk_usd || 0);
      totalRiskUsd += d.type === 'MATCHED' ? 0 : (d.money_at_risk_usd || 0);
    }
    return res.json(createKpiSummary({
      total_orders: ordersCount,
      total_payments: paymentsCount,
      total_reconciled: matched,
      total_discrepancies: discreps,
      total_money_at_risk_usd: round2(totalRiskUsd),
      fx_rate_eur_to_usd: FX_EUR_TO_USD,
      by_type: byType,
      by_type_money: byTypeMoney,
    }));
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

app.get('/api/runs/:runId/discrepancies', authenticate, async (req, res) => {
  try {
    await connectDb();
    const { types, currency, min_amount, max_amount, q, include_matched } = req.query;
    const filter = { run_id: req.params.runId, user_id: req.user.id };
    if (types) filter.type = { $in: types.split(',') };
    if (currency) filter.currency = currency;
    if (min_amount !== undefined || max_amount !== undefined) {
      filter.money_at_risk_usd = {};
      if (min_amount !== undefined) filter.money_at_risk_usd.$gte = Number(min_amount);
      if (max_amount !== undefined) filter.money_at_risk_usd.$lte = Number(max_amount);
    }
    let docs = await db.collection('discrepancies').find(filter).sort({ money_at_risk_usd: -1 }).toArray();
    if (include_matched !== 'true') {
      docs = docs.filter((d) => d.type !== 'MATCHED');
    }
    if (q) {
      const needle = q.toLowerCase();
      docs = docs.filter((d) => `${d.order_id || ''} ${d.payment_id || ''}`.toLowerCase().includes(needle));
    }
    return res.json(docs.map(({ _id, ...rest }) => createDiscrepancyOut(rest)));
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

app.post('/api/discrepancies/:discrepancyId/explain', authenticate, async (req, res) => {
  try {
    await connectDb();
    const doc = await db.collection('discrepancies').findOne({ id: req.params.discrepancyId, user_id: req.user.id });
    if (!doc) return res.status(404).json({ detail: 'Discrepancy not found' });
    const explanation = await explainDiscrepancy(doc);
    await db.collection('discrepancies').updateOne({ id: req.params.discrepancyId }, { $set: { llm_explanation: explanation } });
    return res.json({ cached: false, explanation });
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

app.post('/api/discrepancies/:discrepancyId/regenerate', authenticate, async (req, res) => {
  try {
    await connectDb();
    const doc = await db.collection('discrepancies').findOne({ id: req.params.discrepancyId, user_id: req.user.id });
    if (!doc) return res.status(404).json({ detail: 'Discrepancy not found' });
    const explanation = await explainDiscrepancy(doc);
    await db.collection('discrepancies').updateOne({ id: req.params.discrepancyId }, { $set: { llm_explanation: explanation } });
    return res.json({ cached: false, explanation });
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

if (require.main === module) {
  app.listen(port, () => console.log(`Server running on port ${port}`));
}

module.exports = app;

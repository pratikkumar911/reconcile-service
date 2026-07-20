# Order-Payment Reconciliation Dashboard

A full-stack app for store owners to upload their `orders.csv` and `payments.csv`, and get a deterministic reconciliation report with LLM-powered plain-English explanations.

## Live URLs
- Frontend: https://payment-match-hub-7.preview.example.com
- Backend API: same origin, `/api/*`

## Tech stack (as-built)
- **Frontend**: React 19 (CRA + craco), TailwindCSS, shadcn/ui, Recharts, sonner (toasts), Lucide icons
- **Backend**: Node.js + Express + MongoDB
- **Database**: MongoDB
- **Auth**: JWT (Bearer token, HS256) + bcrypt (cost 10)
- **LLM**: OpenAI `gpt-4.1-mini` via configured LLM API key (temperature 0.2, JSON-shape enforced, 15s timeout, one automatic retry, cache in Mongo)
- **FX**: EUR→USD fixed at 1.08

> **Note**: The project now uses Node/Express with MongoDB, and the reconciliation rules, endpoints, and semantics were preserved in the implementation.

## Local setup
```bash
# Backend
cd /app/backend
npm install
# .env should contain: MONGO_URL, DB_NAME, JWT_SECRET, CORS_ORIGINS
# Start the API with: npm start

# Frontend
cd /app/frontend
yarn install
# .env should contain: REACT_APP_BACKEND_URL
sudo supervisorctl restart frontend
```

## Test credentials
Signup fresh via `/auth` (Sign up tab). Sample credentials created during smoke testing:
- Email: `e2e@test.com`
- Password: `testpass123`

## Sample data
`/app/sample_data/orders.csv` and `/app/sample_data/payments.csv` — designed to trigger **every** discrepancy type.

## Reconciliation rules

Amount tolerance: **max(±$0.02, ±0.5% of net_amount)**.

| Type | Rule |
|---|---|
| `MATCHED` | Exactly one payment with status `succeeded`, `paid_amount ≈ net_amount`, currency matches |
| `MISSING_PAYMENT` | Order `completed` but no payment row exists for `order_id` |
| `AMOUNT_MISMATCH` | Payment exists, currency matches, amount outside tolerance |
| `CURRENCY_MISMATCH` | Payment exists but currency ≠ order currency |
| `DUPLICATE_PAYMENT` | >1 `succeeded` payment for the same `order_id` (also fires on duplicate order_id rows in `orders.csv`) |
| `ORPHAN_PAYMENT` | Payment exists but `order_id` not present in orders |
| `CANCELLED_BUT_PAID` | Order status `cancelled` but a `succeeded` payment exists |
| `REFUND_MISMATCH` | Order status `refunded` but no refund payment (or refund amount ≠ net_amount) |
| `STATUS_CONFLICT` | Order `completed` but payment status is `failed` or `pending` |

Each row also gets `money_at_risk` (absolute impact) and `money_at_risk_usd` (EUR converted at 1.08). Sort default: `money_at_risk_usd DESC` so the biggest problems appear first.

Reconciliation is **idempotent** — running the same inputs produces the same classifications.

## API endpoints

All under `/api/*`. All except `/api/auth/*` and `/api/health` require `Authorization: Bearer <token>`.

| Method | Path | Description |
|---|---|---|
| POST | `/auth/signup` | Signup with email+password → `{ token, user }` |
| POST | `/auth/login` | Login → `{ token, user }` |
| GET | `/auth/me` | Current user |
| POST | `/runs` | Multipart upload of `orders_file` + `payments_file` — parses, validates, reconciles, and returns `RunSummary` |
| GET | `/runs` | List user's runs (desc by date) |
| GET | `/runs/{run_id}` | One run summary |
| GET | `/runs/{run_id}/kpis` | KPI aggregates + by-type counts + by-type money |
| GET | `/runs/{run_id}/discrepancies` | Filtered list. Query params: `types` (csv), `currency`, `min_amount`, `max_amount`, `q`, `include_matched` |
| POST | `/discrepancies/{id}/explain` | Get/cache LLM explanation |
| POST | `/discrepancies/{id}/regenerate` | Bypass cache and re-explain |
| GET | `/health` | Liveness |

## LLM approach
- Model: `gpt-4.1-mini` (via configured LLM API key)
- Temperature: 0.2 (low for consistent explanations)
- Prompt requests strict JSON: `{ summary, likely_cause, suggested_action }`
- Response is parsed leniently (strips code fences, extracts first JSON object), validated for shape
- Timeout 15s. On timeout or malformed JSON: one retry; then graceful fallback message
- Cached in `discrepancies.llm_explanation` — re-open the side panel = free / instant

## Robustness
- CSV upload: `.csv` extension check, max **5MB**, header validation (returns 400 with the missing headers)
- Skipped rows are counted and their first 50 reasons are returned in the run summary
- LLM calls wrapped in `asyncio.wait_for` + try/except
- No secrets logged; `.env` git-ignored; use `.env.example` (see below)

## Findings from the sample data
Uploading `/app/sample_data/orders.csv` + `/app/sample_data/payments.csv` produces:
- 10 orders, 9 payments
- 9 discrepancies + 1 matched (O-1001) + 1 matched refund (O-1005)
- **Total money at risk: $865.10 USD**
- One CURRENCY_MISMATCH (O-1003 booked in EUR, paid in USD → 120 EUR ≈ $129.60 USD at risk)
- One CANCELLED_BUT_PAID (O-1004 cancelled but $75 paid — refund needed)
- One STATUS_CONFLICT (O-1007 order completed but payment `failed`)
- Duplicate payments for O-1006 (P-9006 + P-9006B) — one duplicate refund needed
- Duplicate order rows for O-1008 — dedupe your export
- MISSING_PAYMENT for O-1009 ($300 lost or unrecorded)
- ORPHAN_PAYMENT P-9999 for unknown order O-9999
- AMOUNT_MISMATCH for O-1002 (paid $49.50 vs expected $50.00)

## Future improvements
- Multi-tenant workspaces (share runs w/ teammates, roles)
- Server-side pagination + virtualization on discrepancies table
- Async ingestion with progress via SSE for very large CSVs
- Configurable FX (multiple currencies, live rates)
- Auto-suggest field mapping when CSV headers don't match exactly (fuzzy match)
- Rate-limiting on `/auth/*` with slowapi
- CSV export of filtered discrepancies
- Compare two runs side-by-side (delta view)
- Batch "Explain all top 5" action

## Note on AI-tool usage
This repository was scaffolded and implemented with a local full-stack setup. All reconciliation rules, tolerance math, and endpoint contracts are enforced deterministically in code (`/app/backend/reconcile.js`).

## `.env.example`
See `/app/backend/.env.example` if present.

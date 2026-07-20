# Order-Payment Reconciliation Dashboard

A full-stack app for store owners to upload their `orders.csv` and `payments.csv`, and get a deterministic reconciliation report with LLM-powered plain-English explanations.

## Tech stack (as-built)
- **Frontend**: React 19 (CRA + craco), TailwindCSS, shadcn/ui, Recharts, sonner (toasts), Lucide icons
- **Backend**: Node.js + Express + MongoDB
- **Database**: MongoDB
- **Auth**: JWT (Bearer token, HS256, 7-day expiry) + bcrypt (cost 10)
- **LLM**: OpenAI `gpt-4.1-mini` via configured LLM API key (temperature 0.2, JSON-shape enforced, cached in Mongo — see LLM approach below for the timeout caveat)
- **FX**: EUR→USD fixed at 1.08

## Local setup
```bash
# Backend (from the repo root)
cd backend
npm install
# create backend/.env with:
#   PORT=8000                                (optional, defaults to 8000)
#   MONGO_URL=mongodb://127.0.0.1:27017       (include the db name in the URL, e.g. .../reconcile)
#   JWT_SECRET=some-long-random-string
npm start

# Frontend (from the repo root, in a second terminal)
cd frontend
npm install
# create frontend/.env with:
#   REACT_APP_BACKEND_URL=http://localhost:8000   (leave unset to call same-origin /api)
npm start
```

> No `.env.example` files currently exist in the repo — the vars above are read directly from `backend/.env` / `frontend/.env` via `dotenv`, with sane local defaults if omitted.
>
> CORS is currently wide open (`app.use(cors())`, no origin allowlist) — fine for local dev, but should be locked down before any real deployment.

## Test credentials
No seeded accounts — sign up fresh via `/auth` (Sign up tab) with any email + a 6+ character password.

## Sample data
`sample_data/orders.csv` and `sample_data/payments.csv` — designed to trigger **every** discrepancy type.

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

All under `/api/*`. All except `/api/auth/signup` and `/api/auth/login` require `Authorization: Bearer <token>`.

| Method | Path | Description |
|---|---|---|
| POST | `/auth/signup` | Signup with email+password → `{ token, user }` |
| POST | `/auth/login` | Login → `{ token, user }` |
| GET | `/auth/me` | Current user |
| POST | `/runs` | Multipart upload of `orders_file` + `payments_file` — parses, validates, reconciles, and returns `RunSummary` |
| GET | `/runs/{run_id}` | One run summary |
| GET | `/runs/{run_id}/kpis` | KPI aggregates + by-type counts + by-type money |
| GET | `/runs/{run_id}/discrepancies` | Filtered list. Query params: `types` (csv), `currency`, `min_amount`, `max_amount`, `q`, `include_matched` |
| POST | `/discrepancies/{id}/explain` | Get/cache LLM explanation |
| POST | `/discrepancies/{id}/regenerate` | Bypass cache and re-explain |

> **Known gap**: `frontend/src/pages/RunsPage.js` (a run-history list view) calls `GET /api/runs` to list all of a user's runs, and links each row to `/runs/{id}`. That list endpoint **does not exist yet** on the backend, and `RunsPage` isn't currently mounted in `App.js`'s routes either. Both need to be added before the history view can work — see Future improvements.

## Frontend routes

| Path | Page | Notes |
|---|---|---|
| `/auth` | `AuthPage` | Public only — redirects to `/` if already logged in |
| `/` | `DashboardPage` | Protected. Shows the most recently loaded run, or an empty state if none is loaded yet |
| `/runs/:runId` | `DashboardPage` | Protected. Loads a specific run by ID — this is what makes a reconciliation survive a page refresh, since the run ID lives in the URL instead of only in memory |
| `*` | — | Redirects to `/` |

## LLM approach
- Model: `gpt-4.1-mini` (via configured `LLM_API_KEY` env var; falls back to a canned message if unset)
- Temperature: 0.2 (low for consistent explanations)
- Prompt requests strict JSON: `{ summary, likely_cause, suggested_action }`
- Response is parsed leniently (extracts first `{...}` JSON object from the text), validated for shape
- Whole call wrapped in try/catch → any error (network, non-2xx, malformed JSON) falls back to a canned "couldn't be generated" message. **Note**: a `TIMEOUT_S = 15` constant is declared in `llm.js` but not currently enforced (no request timeout or retry is actually wired up) — see Future improvements
- Cached in `discrepancies.llm_explanation` — re-open the side panel = free / instant

## Robustness
- CSV upload: `.csv` extension check, max **5MB**, header validation (returns 400 with the missing headers)
- Skipped rows are counted and their first 50 reasons are returned in the run summary
- LLM calls wrapped in try/catch with a graceful fallback (see above)
- No secrets logged; `.env` is git-ignored

## Findings from the sample data
Uploading `sample_data/orders.csv` + `sample_data/payments.csv` produces:
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
- Add the missing `GET /runs` list endpoint and mount `RunsPage` at `/runs` so run history actually works
- Multi-tenant workspaces (share runs w/ teammates, roles)
- Server-side pagination + virtualization on discrepancies table
- Async ingestion with progress via SSE for very large CSVs
- Configurable FX (multiple currencies, live rates)
- Auto-suggest field mapping when CSV headers don't match exactly (fuzzy match)
- Actually enforce the `TIMEOUT_S` request timeout in `llm.js`, and add one automatic retry on timeout/malformed JSON
- Restrict CORS to an explicit origin allowlist instead of `cors()` wide open
- Rate-limiting on `/auth/*`
- Add a `/api/health` liveness endpoint
- Add `.env.example` files for both `backend/` and `frontend/`
- CSV export of filtered discrepancies
- Compare two runs side-by-side (delta view)
- Batch "Explain all top 5" action

## Note on AI-tool usage
This repository was scaffolded and implemented with a local full-stack setup. All reconciliation rules, tolerance math, and endpoint contracts are enforced deterministically in code (`backend/reconcile.js`).
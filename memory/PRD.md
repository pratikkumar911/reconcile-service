# PRD — Order-Payment Reconciliation Dashboard

## Original problem statement
Build a fully deployed Order-Payment Reconciliation Dashboard. A store owner uploads two CSVs (`orders.csv` and `payments.csv`). The app reconciles them by `order_id`, classifies each into one of 9 discrepancy types, and uses an LLM to explain each discrepancy in plain English.

## Tech stack (adapted from user's original spec)
- Frontend: React (CRA + craco) + TailwindCSS + shadcn/ui + Recharts
- Backend: FastAPI (Python)
- Database: MongoDB (via motor)
- Auth: custom JWT (Bearer in localStorage) + bcrypt
- LLM: OpenAI `gpt-4.1-mini` via Emergent Universal Key (emergentintegrations)
- FX EUR→USD: fixed 1.08

## User persona
Store operations owner. Uploads a monthly export of orders + payment-processor CSVs. Wants to see: how much money is at risk, what's mismatched, why, and what to do about it.

## Core requirements (locked)
1. Auth: signup + login, JWT-scoped data.
2. Two CSV upload with header validation, size cap 5MB, malformed row skip w/ reasons.
3. Deterministic reconciliation with 9 types + `money_at_risk` per row.
4. Dashboard: KPI cards, Recharts bar chart of discrepancies by type, drill-down table.
5. Filters (multi-type, currency, amount range, text search on order_id/payment_id).
6. LLM explain endpoint w/ cache, retry, graceful fallback.
7. Runs history — every upload is a new immutable run.

## Implemented (2026-02)
- [x] JWT auth (signup, login, /me)
- [x] Ingestion + reconciliation engine (all 9 types + MATCHED)
- [x] Runs history + KPI endpoint + filtered discrepancies endpoint
- [x] LLM explain endpoint w/ caching + regenerate
- [x] Frontend: auth page, dashboard (upload, KPIs, chart, table, side sheet), runs history
- [x] Sample CSVs and E2E smoke test verified

## Prioritized backlog
- **P1** — Add donut chart of Reconciled vs Discrepancies %
- **P1** — CSV export of discrepancies filtered view
- **P2** — Email digest of runs
- **P2** — Drag order-of-magnitude filter presets ("Show top 10 by risk")
- **P2** — Delete run action (with confirm)
- **P2** — Compare two runs side-by-side
- **P2** — Rate-limit auth endpoints (slowapi)

## Notes / deviations from original brief
- Environment mandates React + FastAPI + MongoDB (not Node/Express/Postgres/Prisma per user's prompt). User confirmed proceeding with this stack.
- JWT stored in localStorage as Bearer token (not httpOnly cookie) for simpler cross-origin ingress compatibility; can be switched with reverse-proxy same-domain deploy.
- Model swapped from `gpt-4o-mini` → `gpt-4.1-mini` because it supports low temperature via Emergent LLM key.

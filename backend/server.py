"""Order-Payment Reconciliation Dashboard - FastAPI backend."""
import os
import csv
import io
import uuid
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Optional
from collections import Counter, defaultdict

from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Depends, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient

from models import (
    UserSignup, UserLogin, UserPublic, AuthResponse,
    RunSummary, DiscrepancyOut, KpiSummary,
)
from auth import hash_password, verify_password, create_token, get_current_user
from reconcile import reconcile, FX_EUR_TO_USD, _to_usd
from llm import explain_discrepancy

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# --- DB ---
mongo_url = os.environ["MONGO_URL"]
mongo_client = AsyncIOMotorClient(mongo_url)
db = mongo_client[os.environ["DB_NAME"]]

# --- FastAPI ---
app = FastAPI(title="Reconciliation Dashboard API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

MAX_UPLOAD_MB = 5


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------- Auth ----------------
@api.post("/auth/signup", response_model=AuthResponse)
async def signup(body: UserSignup):
    email = body.email.lower().strip()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    uid = str(uuid.uuid4())
    doc = {
        "id": uid,
        "email": email,
        "password_hash": hash_password(body.password),
        "created_at": _now_iso(),
    }
    await db.users.insert_one(doc)
    token = create_token(uid, email)
    return AuthResponse(
        token=token,
        user=UserPublic(id=uid, email=email, created_at=doc["created_at"]),
    )


@api.post("/auth/login", response_model=AuthResponse)
async def login(body: UserLogin):
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(user["id"], user["email"])
    return AuthResponse(
        token=token,
        user=UserPublic(id=user["id"], email=user["email"], created_at=user["created_at"]),
    )


@api.get("/auth/me", response_model=UserPublic)
async def me(current=Depends(get_current_user)):
    user = await db.users.find_one({"id": current["id"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return UserPublic(**user)


# ---------------- CSV parsing helpers ----------------
ORDERS_HEADERS = {
    "order_id", "customer_email", "order_date", "gross_amount",
    "discount", "net_amount", "currency", "status",
}
PAYMENTS_HEADERS = {
    "payment_id", "order_id", "paid_amount", "currency",
    "payment_date", "method", "status",
}


def _validate_upload(file: UploadFile, content: bytes) -> None:
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail=f"{file.filename}: expected .csv file")
    if len(content) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"{file.filename}: file too large (>{MAX_UPLOAD_MB}MB)")


def _parse_float(v) -> Optional[float]:
    if v is None:
        return None
    s = str(v).strip().replace(",", "")
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_date(v) -> Optional[str]:
    if not v:
        return None
    s = str(v).strip()
    for fmt in (
        "%Y-%m-%d",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%m/%d/%Y",
        "%m/%d/%Y %H:%M",
        "%d/%m/%Y",
        "%d/%m/%Y %H:%M",
        "%d-%m-%Y",
    ):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            continue
    return s  # keep raw if unparseable


# Header aliases — accept common variations seen in real payment-processor exports.
ORDERS_ALIASES = {
    "order_id": ["order_id", "order_reference", "orderid", "order id", "id"],
    "customer_email": ["customer_email", "email", "customer", "buyer_email"],
    "order_date": ["order_date", "created_at", "date", "placed_at"],
    "gross_amount": ["gross_amount", "gross", "subtotal", "amount"],
    "discount": ["discount", "discount_amount"],
    "net_amount": ["net_amount", "net", "total", "grand_total"],
    "currency": ["currency", "curr"],
    "status": ["status", "order_status", "state"],
}
PAYMENTS_ALIASES = {
    "payment_id": ["payment_id", "transaction_ref", "transaction_id", "txn_id", "reference"],
    "order_id": ["order_id", "order_reference", "order_ref"],
    "paid_amount": ["paid_amount", "amount", "amount_paid", "gross_amount", "captured_amount"],
    "currency": ["currency", "curr"],
    "payment_date": ["payment_date", "processed_at", "created_at", "date", "captured_at"],
    "method": ["method", "type", "payment_method", "channel"],
    "status": ["status", "payment_status", "state"],
}


def _resolve_aliases(row: dict, alias_map: dict) -> dict:
    """Return a dict with canonical keys, resolved from the row via alias_map."""
    lower_row = {(k or "").strip().lower(): v for k, v in row.items()}
    out = {}
    for canonical, options in alias_map.items():
        for opt in options:
            if opt.lower() in lower_row and lower_row[opt.lower()] not in (None, ""):
                out[canonical] = lower_row[opt.lower()]
                break
    return out


def _missing_canonical_headers(headers: set, alias_map: dict, required: set) -> List[str]:
    """Return canonical header names for which no alias is present in headers."""
    headers_lower = {(h or "").strip().lower() for h in headers}
    missing = []
    for canonical in required:
        options = alias_map.get(canonical, [canonical])
        if not any(opt.lower() in headers_lower for opt in options):
            missing.append(canonical)
    return sorted(missing)


# Status value normalization to our canonical vocabulary.
STATUS_SUCCESS_ALIASES = {"succeeded", "success", "successful", "settled", "captured", "paid", "completed", "complete"}
STATUS_FAILED_ALIASES = {"failed", "fail", "declined", "error"}
STATUS_PENDING_ALIASES = {"pending", "processing", "authorizing", "requires_action"}
STATUS_REFUNDED_ALIASES = {"refunded", "refund", "reversed", "chargeback"}


def _normalize_payment_status(status: str, method: str, amount: float) -> (str, float):
    """Return (canonical_status, signed_amount).

    Rules: if method/type indicates refund → status="refunded" and amount negated (unless already negative).
    Otherwise map raw status to our vocabulary (succeeded/failed/pending/refunded).
    """
    s = (status or "").strip().lower()
    m = (method or "").strip().lower()
    signed = amount

    if m in {"refund", "refunded", "reversal"} and s in STATUS_SUCCESS_ALIASES | STATUS_REFUNDED_ALIASES:
        return "refunded", -abs(amount)
    if s in STATUS_REFUNDED_ALIASES:
        return "refunded", -abs(amount) if signed > 0 else signed
    if s in STATUS_SUCCESS_ALIASES:
        return "succeeded", signed
    if s in STATUS_FAILED_ALIASES:
        return "failed", signed
    if s in STATUS_PENDING_ALIASES:
        return "pending", signed
    return s or "unknown", signed


def _read_csv_rows(content: bytes) -> List[dict]:
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    return [{(k or "").strip(): (v.strip() if isinstance(v, str) else v) for k, v in row.items()} for row in reader]


def _normalize_orders(rows: List[dict]) -> (List[dict], List[str]):
    out: List[dict] = []
    skipped: List[str] = []
    for i, r in enumerate(rows, start=2):  # +2 for header row
        r = _resolve_aliases(r, ORDERS_ALIASES)
        oid = (r.get("order_id") or "").strip()
        if not oid:
            skipped.append(f"orders row {i}: missing order_id")
            continue
        net = _parse_float(r.get("net_amount"))
        gross = _parse_float(r.get("gross_amount"))
        discount = _parse_float(r.get("discount"))
        # if net missing, compute from gross-discount
        if net is None and gross is not None:
            net = round((gross or 0.0) - (discount or 0.0), 2)
        if net is None:
            skipped.append(f"orders row {i}: missing net_amount")
            continue
        email = (r.get("customer_email") or "").strip().lower() or None
        currency = (r.get("currency") or "USD").strip().upper()
        status = (r.get("status") or "").strip().lower()
        # Normalize order status
        if status in STATUS_SUCCESS_ALIASES:
            status = "completed"
        elif status in {"cancelled", "canceled", "void", "voided"}:
            status = "cancelled"
        elif status in STATUS_REFUNDED_ALIASES:
            status = "refunded"
        out.append({
            "order_id": oid,
            "customer_email": email,
            "order_date": _parse_date(r.get("order_date")),
            "gross_amount": round(gross, 2) if gross is not None else None,
            "discount": round(discount, 2) if discount is not None else 0.0,
            "net_amount": round(net, 2),
            "currency": currency,
            "status": status,
        })
    return out, skipped


def _normalize_payments(rows: List[dict]) -> (List[dict], List[str]):
    out: List[dict] = []
    skipped: List[str] = []
    for i, r in enumerate(rows, start=2):
        r = _resolve_aliases(r, PAYMENTS_ALIASES)
        pid = (r.get("payment_id") or "").strip()
        oid = (r.get("order_id") or "").strip()
        if not pid:
            skipped.append(f"payments row {i}: missing payment_id")
            continue
        amt = _parse_float(r.get("paid_amount"))
        if amt is None:
            skipped.append(f"payments row {i}: missing paid_amount")
            continue
        raw_method = (r.get("method") or "").strip().lower() or None
        raw_status = (r.get("status") or "").strip().lower()
        canonical_status, signed_amount = _normalize_payment_status(raw_status, raw_method or "", amt)
        out.append({
            "payment_id": pid,
            "order_id": oid or None,
            "paid_amount": round(signed_amount, 2),
            "currency": (r.get("currency") or "USD").strip().upper(),
            "payment_date": _parse_date(r.get("payment_date")),
            "method": raw_method,
            "status": canonical_status,
        })
    return out, skipped


# ---------------- Runs ----------------
@api.post("/runs", response_model=RunSummary)
async def create_run(
    orders_file: UploadFile = File(...),
    payments_file: UploadFile = File(...),
    current=Depends(get_current_user),
):
    orders_bytes = await orders_file.read()
    payments_bytes = await payments_file.read()
    _validate_upload(orders_file, orders_bytes)
    _validate_upload(payments_file, payments_bytes)

    orders_rows = _read_csv_rows(orders_bytes)
    payments_rows = _read_csv_rows(payments_bytes)

    if not orders_rows:
        raise HTTPException(status_code=400, detail="orders.csv is empty or unreadable")
    if not payments_rows:
        raise HTTPException(status_code=400, detail="payments.csv is empty or unreadable")

    # Header validation (alias-aware)
    orders_headers = set(orders_rows[0].keys())
    payments_headers = set(payments_rows[0].keys())
    missing_o = _missing_canonical_headers(orders_headers, ORDERS_ALIASES, ORDERS_HEADERS)
    if missing_o:
        raise HTTPException(status_code=400, detail=f"orders.csv missing headers: {missing_o}")
    missing_p = _missing_canonical_headers(payments_headers, PAYMENTS_ALIASES, PAYMENTS_HEADERS)
    if missing_p:
        raise HTTPException(status_code=400, detail=f"payments.csv missing headers: {missing_p}")

    orders_norm, orders_skipped = _normalize_orders(orders_rows)
    payments_norm, payments_skipped = _normalize_payments(payments_rows)

    run_id = str(uuid.uuid4())
    user_id = current["id"]

    # Persist rows (attach ids)
    for o in orders_norm:
        o["_pk"] = str(uuid.uuid4())
        o["user_id"] = user_id
        o["run_id"] = run_id
    for p in payments_norm:
        p["_pk"] = str(uuid.uuid4())
        p["user_id"] = user_id
        p["run_id"] = run_id

    if orders_norm:
        await db.orders.insert_many([dict(o) for o in orders_norm])
    if payments_norm:
        await db.payments.insert_many([dict(p) for p in payments_norm])

    # Reconcile
    discrepancies = reconcile(orders_norm, payments_norm, run_id=run_id, user_id=user_id)
    if discrepancies:
        await db.discrepancies.insert_many([dict(d) for d in discrepancies])

    # Counts + money
    counts = Counter(d["type"] for d in discrepancies)
    total_risk_usd = round(sum(d["money_at_risk_usd"] for d in discrepancies if d["type"] != "MATCHED"), 2)

    run_doc = {
        "id": run_id,
        "user_id": user_id,
        "orders_filename": orders_file.filename or "orders.csv",
        "payments_filename": payments_file.filename or "payments.csv",
        "orders_count": len(orders_norm),
        "payments_count": len(payments_norm),
        "orders_skipped": len(orders_skipped),
        "payments_skipped": len(payments_skipped),
        "skipped_reasons": (orders_skipped + payments_skipped)[:50],
        "total_money_at_risk_usd": total_risk_usd,
        "discrepancy_counts": dict(counts),
        "created_at": _now_iso(),
    }
    await db.runs.insert_one(dict(run_doc))
    return RunSummary(**run_doc)


@api.get("/runs", response_model=List[RunSummary])
async def list_runs(current=Depends(get_current_user)):
    cur = db.runs.find({"user_id": current["id"]}, {"_id": 0}).sort("created_at", -1)
    return [RunSummary(**doc) async for doc in cur]


@api.get("/runs/{run_id}", response_model=RunSummary)
async def get_run(run_id: str, current=Depends(get_current_user)):
    doc = await db.runs.find_one({"id": run_id, "user_id": current["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Run not found")
    return RunSummary(**doc)


@api.get("/runs/{run_id}/kpis", response_model=KpiSummary)
async def get_run_kpis(run_id: str, current=Depends(get_current_user)):
    user_id = current["id"]
    run = await db.runs.find_one({"id": run_id, "user_id": user_id})
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    orders_count = await db.orders.count_documents({"run_id": run_id, "user_id": user_id})
    payments_count = await db.payments.count_documents({"run_id": run_id, "user_id": user_id})

    by_type: dict = {}
    by_type_money: dict = {}
    total_risk_usd = 0.0
    matched = 0
    discreps = 0
    async for d in db.discrepancies.find({"run_id": run_id, "user_id": user_id}, {"_id": 0}):
        t = d["type"]
        by_type[t] = by_type.get(t, 0) + 1
        risk = float(d.get("money_at_risk_usd") or 0.0)
        by_type_money[t] = round(by_type_money.get(t, 0.0) + risk, 2)
        if t == "MATCHED":
            matched += 1
        else:
            discreps += 1
            total_risk_usd += risk

    return KpiSummary(
        total_orders=orders_count,
        total_payments=payments_count,
        total_reconciled=matched,
        total_discrepancies=discreps,
        total_money_at_risk_usd=round(total_risk_usd, 2),
        fx_rate_eur_to_usd=FX_EUR_TO_USD,
        by_type=by_type,
        by_type_money=by_type_money,
    )


# ---------------- Discrepancies ----------------
@api.get("/runs/{run_id}/discrepancies", response_model=List[DiscrepancyOut])
async def list_discrepancies(
    run_id: str,
    types: Optional[str] = Query(None, description="Comma-separated types"),
    currency: Optional[str] = None,
    min_amount: Optional[float] = None,
    max_amount: Optional[float] = None,
    q: Optional[str] = None,
    include_matched: bool = False,
    current=Depends(get_current_user),
):
    query: dict = {"run_id": run_id, "user_id": current["id"]}
    if types:
        types_list = [t.strip() for t in types.split(",") if t.strip()]
        if types_list:
            query["type"] = {"$in": types_list}
    elif not include_matched:
        query["type"] = {"$ne": "MATCHED"}

    if currency:
        query["currency"] = currency.upper()

    if min_amount is not None or max_amount is not None:
        rng = {}
        if min_amount is not None:
            rng["$gte"] = float(min_amount)
        if max_amount is not None:
            rng["$lte"] = float(max_amount)
        query["money_at_risk_usd"] = rng

    if q:
        query["$or"] = [
            {"order_id": {"$regex": q, "$options": "i"}},
            {"payment_id": {"$regex": q, "$options": "i"}},
        ]

    cur = db.discrepancies.find(query, {"_id": 0}).sort("money_at_risk_usd", -1).limit(2000)
    return [DiscrepancyOut(**d) async for d in cur]


@api.post("/discrepancies/{disc_id}/explain")
async def explain(disc_id: str, current=Depends(get_current_user)):
    doc = await db.discrepancies.find_one(
        {"id": disc_id, "user_id": current["id"]}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Discrepancy not found")

    # Return cached explanation if present
    cached = doc.get("llm_explanation")
    if cached and isinstance(cached, dict) and "summary" in cached:
        return {"cached": True, "explanation": cached}

    explanation = await explain_discrepancy(doc)
    await db.discrepancies.update_one(
        {"id": disc_id, "user_id": current["id"]},
        {"$set": {"llm_explanation": explanation}},
    )
    return {"cached": False, "explanation": explanation}


@api.post("/discrepancies/{disc_id}/regenerate")
async def regenerate_explain(disc_id: str, current=Depends(get_current_user)):
    doc = await db.discrepancies.find_one(
        {"id": disc_id, "user_id": current["id"]}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Discrepancy not found")
    explanation = await explain_discrepancy(doc)
    await db.discrepancies.update_one(
        {"id": disc_id, "user_id": current["id"]},
        {"$set": {"llm_explanation": explanation}},
    )
    return {"cached": False, "explanation": explanation}


@api.get("/health")
async def health():
    return {"status": "ok", "time": _now_iso()}


# Include router + CORS
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def _shutdown():
    mongo_client.close()

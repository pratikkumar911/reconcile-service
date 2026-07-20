from pydantic import BaseModel, EmailStr, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
import uuid


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid() -> str:
    return str(uuid.uuid4())


class UserSignup(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=200)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    id: str
    email: EmailStr
    created_at: str


class AuthResponse(BaseModel):
    token: str
    user: UserPublic


class RunSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    user_id: str
    orders_filename: str
    payments_filename: str
    orders_count: int
    payments_count: int
    orders_skipped: int = 0
    payments_skipped: int = 0
    skipped_reasons: List[str] = Field(default_factory=list)
    total_money_at_risk_usd: float = 0.0
    discrepancy_counts: Dict[str, int] = Field(default_factory=dict)
    created_at: str


class DiscrepancyOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    run_id: str
    type: str
    order_id: Optional[str] = None
    payment_id: Optional[str] = None
    expected_amount: Optional[float] = None
    actual_amount: Optional[float] = None
    currency: Optional[str] = None
    money_at_risk: float = 0.0
    money_at_risk_usd: float = 0.0
    details_json: Dict[str, Any] = Field(default_factory=dict)
    llm_explanation: Optional[Dict[str, Any]] = None
    created_at: str


class KpiSummary(BaseModel):
    total_orders: int
    total_payments: int
    total_reconciled: int
    total_discrepancies: int
    total_money_at_risk_usd: float
    fx_rate_eur_to_usd: float
    by_type: Dict[str, int]
    by_type_money: Dict[str, float]

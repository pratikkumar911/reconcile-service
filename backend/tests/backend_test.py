"""Backend API tests for the Order-Payment Reconciliation Dashboard."""
import os
import uuid
import time
import io
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://payment-match-hub-7.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

SAMPLE_ORDERS = "/app/sample_data/orders.csv"
SAMPLE_PAYMENTS = "/app/sample_data/payments.csv"


# ---------- Fixtures ----------
def _rand_email(prefix="tester"):
    return f"{prefix}_{uuid.uuid4().hex[:8]}@example.com"


@pytest.fixture(scope="module")
def user_a():
    email = _rand_email("a")
    r = requests.post(f"{API}/auth/signup", json={"email": email, "password": "testpass123"})
    assert r.status_code == 200, r.text
    d = r.json()
    return {"email": email, "password": "testpass123", "token": d["token"], "id": d["user"]["id"]}


@pytest.fixture(scope="module")
def user_b():
    email = _rand_email("b")
    r = requests.post(f"{API}/auth/signup", json={"email": email, "password": "testpass123"})
    assert r.status_code == 200, r.text
    d = r.json()
    return {"email": email, "password": "testpass123", "token": d["token"], "id": d["user"]["id"]}


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- Health ----------
def test_health():
    r = requests.get(f"{API}/health")
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


# ---------- Auth ----------
def test_signup_and_duplicate():
    email = _rand_email("dup")
    r = requests.post(f"{API}/auth/signup", json={"email": email, "password": "testpass123"})
    assert r.status_code == 200
    body = r.json()
    assert "token" in body
    assert body["user"]["email"] == email.lower()

    # Duplicate signup -> 400
    r2 = requests.post(f"{API}/auth/signup", json={"email": email, "password": "testpass123"})
    assert r2.status_code == 400


def test_login_success_and_wrong_password(user_a):
    r = requests.post(f"{API}/auth/login", json={"email": user_a["email"], "password": user_a["password"]})
    assert r.status_code == 200
    assert "token" in r.json()

    r2 = requests.post(f"{API}/auth/login", json={"email": user_a["email"], "password": "wrong-password"})
    assert r2.status_code == 401


def test_auth_me(user_a):
    r = requests.get(f"{API}/auth/me", headers=_auth(user_a["token"]))
    assert r.status_code == 200
    assert r.json()["email"] == user_a["email"].lower()

    r2 = requests.get(f"{API}/auth/me")
    assert r2.status_code == 401


# ---------- Runs (upload + reconcile) ----------
@pytest.fixture(scope="module")
def run_for_user_a(user_a):
    with open(SAMPLE_ORDERS, "rb") as of, open(SAMPLE_PAYMENTS, "rb") as pf:
        files = {
            "orders_file": ("orders.csv", of, "text/csv"),
            "payments_file": ("payments.csv", pf, "text/csv"),
        }
        r = requests.post(f"{API}/runs", files=files, headers=_auth(user_a["token"]))
    assert r.status_code == 200, r.text
    return r.json()


def test_create_run_sample_data(run_for_user_a):
    d = run_for_user_a
    assert d["orders_count"] == 10
    assert d["payments_count"] == 9
    # Total money at risk approx $865.10
    assert abs(d["total_money_at_risk_usd"] - 865.10) < 0.5
    # 9 discrepancy types + MATCHED
    counts = d["discrepancy_counts"]
    expected_types = {
        "MISSING_PAYMENT", "AMOUNT_MISMATCH", "CURRENCY_MISMATCH",
        "DUPLICATE_PAYMENT", "ORPHAN_PAYMENT", "CANCELLED_BUT_PAID",
        "REFUND_MISMATCH", "STATUS_CONFLICT", "MATCHED",
    }
    # All 9 discrepancy types + MATCHED should be present
    assert expected_types.issubset(set(counts.keys())), f"Missing types: {expected_types - set(counts.keys())}"


def test_list_runs(user_a, run_for_user_a):
    r = requests.get(f"{API}/runs", headers=_auth(user_a["token"]))
    assert r.status_code == 200
    runs = r.json()
    assert any(x["id"] == run_for_user_a["id"] for x in runs)


def test_get_run_kpis(user_a, run_for_user_a):
    rid = run_for_user_a["id"]
    r = requests.get(f"{API}/runs/{rid}/kpis", headers=_auth(user_a["token"]))
    assert r.status_code == 200
    d = r.json()
    assert d["total_orders"] == 10
    assert d["total_payments"] == 9
    assert d["fx_rate_eur_to_usd"] == 1.08
    assert d["total_discrepancies"] >= 8
    assert d["total_reconciled"] >= 1
    # money-at-risk consistency with run summary
    assert abs(d["total_money_at_risk_usd"] - run_for_user_a["total_money_at_risk_usd"]) < 0.5


def test_list_discrepancies_sorted(user_a, run_for_user_a):
    rid = run_for_user_a["id"]
    r = requests.get(f"{API}/runs/{rid}/discrepancies", headers=_auth(user_a["token"]))
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) >= 8
    # Verify descending order by money_at_risk_usd
    vals = [row["money_at_risk_usd"] for row in rows]
    assert vals == sorted(vals, reverse=True)
    # Non-matched by default
    assert all(row["type"] != "MATCHED" for row in rows)


def test_discrepancy_filters(user_a, run_for_user_a):
    rid = run_for_user_a["id"]
    h = _auth(user_a["token"])

    # types=MISSING_PAYMENT
    r = requests.get(f"{API}/runs/{rid}/discrepancies?types=MISSING_PAYMENT", headers=h)
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) >= 1
    assert all(row["type"] == "MISSING_PAYMENT" for row in rows)

    # currency=USD
    r = requests.get(f"{API}/runs/{rid}/discrepancies?currency=USD", headers=h)
    assert r.status_code == 200
    rows = r.json()
    assert all(row["currency"] == "USD" for row in rows)

    # min/max amount
    r = requests.get(f"{API}/runs/{rid}/discrepancies?min_amount=50&max_amount=100", headers=h)
    assert r.status_code == 200
    rows = r.json()
    for row in rows:
        assert 50 <= row["money_at_risk_usd"] <= 100

    # q=O-1006 substring
    r = requests.get(f"{API}/runs/{rid}/discrepancies?q=O-1006", headers=h)
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) >= 1
    assert all("O-1006" in (row.get("order_id") or "") or "O-1006" in (row.get("payment_id") or "") for row in rows)


# ---------- LLM explain caching ----------
def test_explain_and_cache(user_a, run_for_user_a):
    rid = run_for_user_a["id"]
    h = _auth(user_a["token"])
    r = requests.get(f"{API}/runs/{rid}/discrepancies", headers=h)
    disc_id = r.json()[0]["id"]

    r1 = requests.post(f"{API}/discrepancies/{disc_id}/explain", headers=h, timeout=30)
    assert r1.status_code == 200
    d1 = r1.json()
    assert d1.get("cached") is False
    exp = d1["explanation"]
    assert "summary" in exp and "likely_cause" in exp and "suggested_action" in exp

    # Second call should be cached
    r2 = requests.post(f"{API}/discrepancies/{disc_id}/explain", headers=h, timeout=30)
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2.get("cached") is True

    # Regenerate bypasses cache
    r3 = requests.post(f"{API}/discrepancies/{disc_id}/regenerate", headers=h, timeout=30)
    assert r3.status_code == 200
    d3 = r3.json()
    assert d3.get("cached") is False


# ---------- CSV validation ----------
def test_upload_non_csv_extension(user_a):
    h = _auth(user_a["token"])
    files = {
        "orders_file": ("orders.txt", b"order_id\nO-1", "text/plain"),
        "payments_file": ("payments.csv", open(SAMPLE_PAYMENTS, "rb"), "text/csv"),
    }
    r = requests.post(f"{API}/runs", files=files, headers=h)
    assert r.status_code == 400
    assert "csv" in r.text.lower()


def test_upload_missing_headers(user_a):
    h = _auth(user_a["token"])
    bad_orders = b"order_id,foo\nO-1,bar\n"
    files = {
        "orders_file": ("orders.csv", bad_orders, "text/csv"),
        "payments_file": ("payments.csv", open(SAMPLE_PAYMENTS, "rb"), "text/csv"),
    }
    r = requests.post(f"{API}/runs", files=files, headers=h)
    assert r.status_code == 400
    assert "missing headers" in r.text.lower()


def test_upload_too_large(user_a):
    h = _auth(user_a["token"])
    # 6MB of bytes -> larger than MAX_UPLOAD_MB=5
    big = b"order_id,customer_email,order_date,gross_amount,discount,net_amount,currency,status\n" + b"x" * (6 * 1024 * 1024)
    files = {
        "orders_file": ("orders.csv", big, "text/csv"),
        "payments_file": ("payments.csv", open(SAMPLE_PAYMENTS, "rb"), "text/csv"),
    }
    r = requests.post(f"{API}/runs", files=files, headers=h)
    assert r.status_code == 400
    assert "too large" in r.text.lower()


# ---------- Data isolation ----------
def test_data_isolation(user_a, user_b, run_for_user_a):
    r = requests.get(f"{API}/runs", headers=_auth(user_b["token"]))
    assert r.status_code == 200
    runs_b = r.json()
    assert all(x["id"] != run_for_user_a["id"] for x in runs_b)

    # User B tries to fetch user A's run
    r = requests.get(f"{API}/runs/{run_for_user_a['id']}", headers=_auth(user_b["token"]))
    assert r.status_code == 404

"""Phase 2/7 backend tests: Google session, manual KYC review without invented monetary thresholds,
admin customers lookup, notifications since (live alerts poll)."""
import io
import uuid
import time
import requests
from datetime import datetime, timezone
from .conftest import API, auth

APPLE_BRAND = None


def _get_apple_brand(http):
    global APPLE_BRAND
    if APPLE_BRAND:
        return APPLE_BRAND
    r = http.get(f"{API}/brands?q=Apple", timeout=30)
    assert r.status_code == 200
    bs = r.json()["brands"]
    APPLE_BRAND = next((b for b in bs if "Apple" in b["name"] or "iTunes" in b["name"]), bs[0] if bs else None)
    if not APPLE_BRAND:
        # fallback: any brand with a high rate
        r2 = http.get(f"{API}/brands", timeout=30)
        APPLE_BRAND = sorted(r2.json()["brands"], key=lambda b: -b["rate_kobo_per_usd"])[0]
    return APPLE_BRAND


def _signup(http, prefix="p2"):
    email = f"TEST_{prefix}_{uuid.uuid4().hex[:8]}@example.com"
    r = http.post(f"{API}/auth/signup", json={
        "full_name": f"P2 {prefix}", "email": email, "phone": "+2348010000000",
        "password": "Passw0rd!23", "country": "Nigeria",
    }, timeout=30)
    assert r.status_code == 200, r.text
    return {"email": email, "token": r.json()["access_token"], "user": r.json()["user"]}


def _upload(http, tok, name="img.png"):
    img = b"\x89PNG\r\n\x1a\n" + b"0" * 200
    files = {"file": (name, io.BytesIO(img), "image/png")}
    r = requests.post(f"{API}/uploads", headers={"Authorization": f"Bearer {tok}"}, files=files, timeout=60)
    if r.status_code == 502:
        import pytest
        pytest.skip("object storage unavailable in preview")
    assert r.status_code == 200, r.text
    return r.json()["path"]


# --------------------- Google session ---------------------
def test_auth_session_bogus_401(http):
    r = http.post(f"{API}/auth/session", json={"session_id": "bogus"}, timeout=30)
    assert r.status_code == 401
    body = r.json()
    assert "detail" in body and isinstance(body["detail"], str)


def test_auth_session_missing_422(http):
    r = http.post(f"{API}/auth/session", json={}, timeout=30)
    assert r.status_code == 422


# --------------------- KYC customer GET (fresh) ---------------------
def test_kyc_get_fresh_unverified():
    http = requests.Session(); http.headers.update({"Content-Type": "application/json"})
    u = _signup(http, "fresh")
    r = http.get(f"{API}/kyc", headers=auth(u["token"]), timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "unverified"
    assert body["submission"] is None
    policy = body["policy"]
    assert "trade_limit_kobo" not in policy
    assert "withdrawal_limit_kobo" not in policy
    assert isinstance(policy["id_types"], list) and len(policy["id_types"]) == 4


# --------------------- No invented KYC monetary threshold ---------------------
def test_unverified_trade_is_not_blocked_by_unapproved_kyc_threshold():
    http = requests.Session(); http.headers.update({"Content-Type": "application/json"})
    u = _signup(http, "trade")
    b = _get_apple_brand(http)
    big = http.post(f"{API}/trades", headers=auth(u["token"]), json={
        "brand_id": b["id"], "submission_type": "ecode", "card_value_usd": 200, "quantity": 1,
        "ecode": "ABCD-1234",
    }, timeout=30)
    assert big.status_code == 200, big.text


# --------------------- KYC submit validation ---------------------
def test_kyc_submit_invalid_id_type_422():
    http = requests.Session(); http.headers.update({"Content-Type": "application/json"})
    u = _signup(http, "idtype")
    r = http.post(f"{API}/kyc", headers=auth(u["token"]), json={
        "id_type": "invalid_type", "id_number": "12345", "full_name": "X Y",
        "dob": "2000-01-01", "address": "Lagos, NG", "id_front_path": "x", "selfie_path": "y",
    }, timeout=30)
    assert r.status_code == 422


def test_kyc_submit_invalid_paths_400():
    http = requests.Session(); http.headers.update({"Content-Type": "application/json"})
    u = _signup(http, "paths")
    r = http.post(f"{API}/kyc", headers=auth(u["token"]), json={
        "id_type": "nin", "id_number": "12345678901", "full_name": "P2 paths",
        "dob": "2000-01-01", "address": "Lagos, NG",
        "id_front_path": "not/owned/x.png", "selfie_path": "also/wrong/y.png",
    }, timeout=30)
    assert r.status_code == 400
    assert "Invalid document upload" in r.json().get("detail", "")


def test_kyc_full_flow_and_admin_approve_notify(http, admin_token):
    # New user
    u = _signup(http, "full")
    tok = u["token"]

    # Upload docs
    front = _upload(http, tok, "front.png")
    back = _upload(http, tok, "back.png")
    selfie = _upload(http, tok, "selfie.png")

    # Submit KYC
    r = http.post(f"{API}/kyc", headers=auth(tok), json={
        "id_type": "nin", "id_number": "12345678901", "full_name": "Full Flow",
        "dob": "1995-05-05", "address": "1 Test Rd, Lagos",
        "id_front_path": front, "id_back_path": back, "selfie_path": selfie,
    }, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pending"
    sub = body["submission"]
    assert "id_number_masked" in sub
    assert "id_number" not in sub
    kyc_id = sub["id"]

    # /auth/me shows pending
    me = http.get(f"{API}/auth/me", headers=auth(tok), timeout=30).json()
    assert me["user"]["kyc_status"] == "pending"

    # Second submit while pending -> 400
    r2 = http.post(f"{API}/kyc", headers=auth(tok), json={
        "id_type": "nin", "id_number": "12345678901", "full_name": "Full Flow",
        "dob": "1995-05-05", "address": "1 Test Rd, Lagos",
        "id_front_path": front, "selfie_path": selfie,
    }, timeout=30)
    assert r2.status_code == 400

    # Admin list pending
    lst = http.get(f"{API}/admin/kyc?status=PENDING", headers=auth(admin_token), timeout=30)
    assert lst.status_code == 200
    subs = lst.json()["submissions"]
    match = next((s for s in subs if s["id"] == kyc_id), None)
    assert match is not None
    for f in ("customer_name", "customer_email", "id_type_label", "id_number_masked"):
        assert f in match

    # Admin detail includes full id_number and customer
    det = http.get(f"{API}/admin/kyc/{kyc_id}", headers=auth(admin_token), timeout=30)
    assert det.status_code == 200
    dd = det.json()
    assert dd.get("id_number") == "12345678901"
    assert dd.get("customer") and dd["customer"]["email"].lower() == u["email"].lower()

    # Approve
    ap = http.post(f"{API}/admin/kyc/{kyc_id}/approve", headers=auth(admin_token), timeout=30)
    assert ap.status_code == 200

    # User now verified
    me2 = http.get(f"{API}/auth/me", headers=auth(tok), timeout=30).json()
    assert me2["user"]["kyc_status"] == "verified"

    # Notification of type 'kyc' present
    notif = http.get(f"{API}/notifications", headers=auth(tok), timeout=30).json()
    types = {n.get("type") for n in notif["notifications"]}
    assert "kyc" in types

    # Second approve -> 400 already reviewed
    ap2 = http.post(f"{API}/admin/kyc/{kyc_id}/approve", headers=auth(admin_token), timeout=30)
    assert ap2.status_code == 400

    # Verification status does not invent a monetary trade threshold
    b = _get_apple_brand(http)
    big = http.post(f"{API}/trades", headers=auth(tok), json={
        "brand_id": b["id"], "submission_type": "ecode", "card_value_usd": 200, "quantity": 1,
        "ecode": "AFTER-KYC",
    }, timeout=30)
    assert big.status_code == 200, big.text


def test_kyc_reject_requires_reason_and_allows_resubmit(http, admin_token):
    u = _signup(http, "rej")
    tok = u["token"]
    front = _upload(http, tok, "f.png")
    selfie = _upload(http, tok, "s.png")

    sub = http.post(f"{API}/kyc", headers=auth(tok), json={
        "id_type": "passport", "id_number": "A1234567", "full_name": "Rej User",
        "dob": "1990-01-01", "address": "Lagos", "id_front_path": front, "selfie_path": selfie,
    }, timeout=30).json()
    kid = sub["submission"]["id"]

    # Empty reason -> 400
    empty = http.post(f"{API}/admin/kyc/{kid}/reject", headers=auth(admin_token),
                     json={"reason": "   "}, timeout=30)
    assert empty.status_code == 400

    # Reject with reason
    rj = http.post(f"{API}/admin/kyc/{kid}/reject", headers=auth(admin_token),
                   json={"reason": "unclear document"}, timeout=30)
    assert rj.status_code == 200

    me = http.get(f"{API}/auth/me", headers=auth(tok), timeout=30).json()
    assert me["user"]["kyc_status"] == "rejected"

    # Resubmit allowed
    r2 = http.post(f"{API}/kyc", headers=auth(tok), json={
        "id_type": "passport", "id_number": "A1234567", "full_name": "Rej User",
        "dob": "1990-01-01", "address": "Lagos", "id_front_path": front, "selfie_path": selfie,
    }, timeout=30)
    assert r2.status_code == 200
    assert r2.json()["status"] == "pending"


# --------------------- Admin stats includes pending_kyc ---------------------
def test_admin_stats_has_pending_kyc(http, admin_token):
    r = http.get(f"{API}/admin/stats", headers=auth(admin_token), timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert "pending_kyc" in body
    assert isinstance(body["pending_kyc"], int)


# --------------------- Admin customer lookup ---------------------
def test_admin_users_search_customer(http, admin_token, new_customer):
    r = http.get(f"{API}/admin/users?q={new_customer['email']}", headers=auth(admin_token), timeout=30)
    assert r.status_code == 200
    users = r.json()["users"]
    row = next((u for u in users if u["email"] == new_customer["email"]), None)
    assert row is not None
    for k in ("balance_kobo", "trades_count", "kyc_status", "auth_provider"):
        assert k in row


def test_admin_users_kyc_filter(http, admin_token):
    r = http.get(f"{API}/admin/users?kyc=verified", headers=auth(admin_token), timeout=30)
    assert r.status_code == 200
    users = r.json()["users"]
    assert all(u["kyc_status"] == "verified" for u in users)


def test_admin_user_detail_and_404_and_403(http, admin_token, new_customer):
    uid = new_customer["user"]["id"]
    d = http.get(f"{API}/admin/users/{uid}", headers=auth(admin_token), timeout=30)
    assert d.status_code == 200
    body = d.json()
    for k in ("user", "balance_kobo", "stats", "trades", "withdrawals", "ledger", "payout_accounts", "kyc"):
        assert k in body
    for sk in ("trades", "approved_trades", "total_traded_kobo", "withdrawals", "total_withdrawn_kobo", "referred_count"):
        assert sk in body["stats"]
    for t in body["trades"]:
        assert "ecode" not in t

    nf = http.get(f"{API}/admin/users/nonexistent-id", headers=auth(admin_token), timeout=30)
    assert nf.status_code == 404

    f = http.get(f"{API}/admin/users/{uid}", headers=auth(new_customer["token"]), timeout=30)
    assert f.status_code == 403


# --------------------- Notifications since ---------------------
def test_notifications_since_flow(http, admin_token):
    u = _signup(http, "since")
    tok = u["token"]
    # No ts
    r = http.get(f"{API}/notifications/since", headers=auth(tok), timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert body["notifications"] == []
    assert "server_time" in body
    server_time = body["server_time"]

    # Invalid ts
    bad = http.get(f"{API}/notifications/since?ts=not-a-date", headers=auth(tok), timeout=30)
    assert bad.status_code == 400

    # Create trade & admin approve
    b = _get_apple_brand(http)
    tr = http.post(f"{API}/trades", headers=auth(tok), json={
        "brand_id": b["id"], "submission_type": "ecode", "card_value_usd": 20, "quantity": 1,
        "ecode": "NOTIF-1",
    }, timeout=30).json()
    # ensure server_time is strictly before the notify by waiting slightly
    time.sleep(1)
    ap = http.post(f"{API}/admin/trades/{tr['id']}/approve", headers=auth(admin_token),
                   json={"note": "ok"}, timeout=30)
    assert ap.status_code == 200

    # Poll (use params= so requests URL-encodes '+' correctly)
    poll = http.get(f"{API}/notifications/since", params={"ts": server_time}, headers=auth(tok), timeout=30)
    assert poll.status_code == 200
    items = poll.json()["notifications"]
    titles = " ".join(str(n.get("title", "")) for n in items)
    assert "approved" in titles.lower() or any("Trade" in str(n.get("title", "")) for n in items), f"expected an approval notification, got: {items}"

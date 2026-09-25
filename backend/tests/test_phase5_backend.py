"""Phase 5/7 backend tests: Trade receipts and admin rate-history audit."""
import uuid
import re
from .conftest import API, auth


# ------------------------------ helpers ------------------------------
def _signup(http, prefix="p5"):
    email = f"TEST_{prefix}_{uuid.uuid4().hex[:8]}@example.com"
    r = http.post(f"{API}/auth/signup", json={
        "full_name": f"P5 {prefix} {uuid.uuid4().hex[:4]}",
        "email": email, "phone": "+2348010000000",
        "password": "Passw0rd!23", "country": "Nigeria",
    }, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _pick_brand(http):
    return http.get(f"{API}/brands?popular=true", timeout=30).json()["brands"][0]


def _brand_body(http, bid):
    full = http.get(f"{API}/brands/{bid}", timeout=30).json()
    return {
        "name": full["name"],
        "category": full.get("category", "Other"),
        "color": full.get("color", "#1F5AF6"),
        "rate_kobo_per_usd": int(full["rate_kobo_per_usd"]),
        "is_active": bool(full.get("is_active", True)),
        "is_popular": bool(full.get("is_popular", False)),
        "submission_types": full.get("submission_types", ["physical", "ecode"]),
        "subcategories": full.get("subcategories", []),
        "countries": full.get("countries", []),
    }


def _create_trade(http, tok, usd=10):
    b = _pick_brand(http)
    tr = http.post(f"{API}/trades", headers=auth(tok), json={
        "brand_id": b["id"], "submission_type": "ecode", "card_value_usd": usd,
        "quantity": 1, "ecode": f"E-{uuid.uuid4().hex[:6]}",
    }, timeout=30)
    assert tr.status_code == 200, tr.text
    return tr.json()


def _create_and_approve_trade(http, admin_token, tok, usd=10):
    tr = _create_trade(http, tok, usd=usd)
    ap = http.post(f"{API}/admin/trades/{tr['id']}/approve", headers=auth(admin_token),
                   json={"note": "ok"}, timeout=30)
    assert ap.status_code == 200, ap.text
    return tr


# ==================================================================
# RECEIPTS — trade
# ==================================================================
def test_trade_receipt_for_approved_trade(http, admin_token):
    u = _signup(http, "receipt_approved")
    tok = u["access_token"]
    t = _create_and_approve_trade(http, admin_token, tok, usd=20)

    r = http.get(f"{API}/receipts/trade/{t['id']}", headers=auth(tok), timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "trade"
    assert body["receipt_no"] == f"RCT-{t['order_id']}"
    assert body["ref"] == t["order_id"]
    assert body["status"] == "APPROVED"
    vc = body["verification_code"]
    assert isinstance(vc, str) and re.fullmatch(r"[0-9A-F]{8}", vc), f"bad verification_code: {vc}"
    # Deterministic — same call returns same code
    r2 = http.get(f"{API}/receipts/trade/{t['id']}", headers=auth(tok), timeout=30)
    assert r2.json()["verification_code"] == vc

    labels = [l["label"] for l in body["lines"]]
    for expected in ("Gift card", "Card value", "Type", "Rate"):
        assert expected in labels, f"missing line {expected}: {labels}"

    expected_total = int(t.get("approved_payout_kobo") or t.get("expected_payout_kobo") or 0)
    assert int(body["total_kobo"]) == expected_total
    assert body["customer"]["email"] == u["user"]["email"]
    assert body["customer"]["name"]  # non-empty


def test_trade_receipt_pending_returns_400(http, admin_token):
    # Create a fresh customer, submit a trade, DON'T approve
    u = _signup(http, "receipt_pending")
    tok = u["access_token"]
    tr = _create_trade(http, tok, usd=10)
    assert tr["status"] == "PENDING_REVIEW"
    r = http.get(f"{API}/receipts/trade/{tr['id']}", headers=auth(tok), timeout=30)
    assert r.status_code == 400, r.text


def test_trade_receipt_other_users_trade_404(http, admin_token):
    owner = _signup(http, "receipt_owner")
    t = _create_and_approve_trade(http, admin_token, owner["access_token"], usd=15)
    other = _signup(http, "receipt_other")
    r = http.get(f"{API}/receipts/trade/{t['id']}", headers=auth(other["access_token"]), timeout=30)
    assert r.status_code == 404, r.text


# ==================================================================
# RECEIPTS — withdrawal
# ==================================================================
def test_withdrawal_receipt_paid_and_pending(http, admin_token):
    # Fresh user, approve a large trade to fund balance, set PIN, create withdrawal
    u = _signup(http, "wd_receipt")
    tok = u["access_token"]
    # fund with a $50 trade so balance is big enough for a small withdrawal
    _create_and_approve_trade(http, admin_token, tok, usd=50)

    # set PIN
    p = http.post(f"{API}/security/pin", headers=auth(tok), json={"pin": "2581"}, timeout=30)
    assert p.status_code == 200, p.text

    # create a payout account
    pa = http.post(f"{API}/payout-accounts", headers=auth(tok), json={
        "provider": "bank",
        "provider_name": "Access Bank",
        "account_number": "0123456789",
        "account_name": "Test User",
    }, timeout=30)
    assert pa.status_code == 200, pa.text
    pa_id = pa.json().get("id") or pa.json().get("account", {}).get("id")

    # small withdrawal (₦1000 = 100000 kobo)
    wd = http.post(f"{API}/withdrawals", headers=auth(tok), json={
        "amount_kobo": 100000,
        "payout_account_id": pa_id,
        "pin": "2581",
    }, timeout=30)
    assert wd.status_code == 200, wd.text
    w = wd.json()
    wid = w["id"]

    # PENDING withdrawal receipt -> 400
    r_pend = http.get(f"{API}/receipts/withdrawal/{wid}", headers=auth(tok), timeout=30)
    assert r_pend.status_code == 400, r_pend.text

    # Admin process -> paid
    pr = http.post(f"{API}/admin/withdrawals/{wid}/process", headers=auth(admin_token), timeout=30)
    assert pr.status_code == 200, pr.text
    pd = http.post(f"{API}/admin/withdrawals/{wid}/paid", headers=auth(admin_token),
                   json={"payment_reference": "REF-TEST-001"}, timeout=30)
    assert pd.status_code == 200, pd.text

    # Now PAID -> 200
    r = http.get(f"{API}/receipts/withdrawal/{wid}", headers=auth(tok), timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "withdrawal"
    assert body["status"] == "PAID"
    assert body["receipt_no"].startswith("RCT-")
    vc = body["verification_code"]
    assert re.fullmatch(r"[0-9A-F]{8}", vc), vc
    labels = [l["label"] for l in body["lines"]]
    assert "Paid to" in labels
    assert "Account" in labels
    assert int(body["total_kobo"]) == 100000


# ==================================================================
# ADMIN RATE HISTORY
# ==================================================================
def test_admin_rate_history_with_and_without_filter(http, admin_token):
    b = _pick_brand(http)
    bid = b["id"]
    base = _brand_body(http, bid)
    original = base["rate_kobo_per_usd"]
    try:
        # +500 then -500
        up = http.patch(f"{API}/admin/brands/{bid}", headers=auth(admin_token),
                        json={**base, "rate_kobo_per_usd": original + 500}, timeout=30)
        assert up.status_code == 200, up.text
        dn = http.patch(f"{API}/admin/brands/{bid}", headers=auth(admin_token),
                        json={**base, "rate_kobo_per_usd": original}, timeout=30)
        assert dn.status_code == 200, dn.text

        # Filtered by brand — newest first
        r = http.get(f"{API}/admin/rate-history?brand_id={bid}&limit=5",
                     headers=auth(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        changes = r.json()["changes"]
        assert len(changes) >= 2
        c0, c1 = changes[0], changes[1]  # newest first
        # newest is the restore (-500), then the raise (+500)
        assert c0["brand_name"] == base["name"]
        assert c1["brand_name"] == base["name"]
        assert c0["by_name"]
        assert c1["by_name"]
        assert int(c0["delta_kobo"]) == -500
        assert int(c1["delta_kobo"]) == 500
        assert isinstance(c0["delta_pct"], (int, float))
        assert isinstance(c1["delta_pct"], (int, float))

        # Unfiltered — includes brands[] summary
        r2 = http.get(f"{API}/admin/rate-history", headers=auth(admin_token), timeout=30)
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert isinstance(body.get("brands"), list) and body["brands"]
        row = next((x for x in body["brands"] if x["brand_id"] == bid), None)
        assert row is not None
        for k in ("count", "last_at", "name"):
            assert k in row, f"brands[] summary missing {k}"
    finally:
        # Restore in case of any partial failure above
        http.patch(f"{API}/admin/brands/{bid}", headers=auth(admin_token),
                   json={**base, "rate_kobo_per_usd": original}, timeout=30)


def test_admin_rate_history_forbidden_for_non_admin(http):
    u = _signup(http, "rh_forbid")
    r = http.get(f"{API}/admin/rate-history", headers=auth(u["access_token"]), timeout=30)
    assert r.status_code == 403

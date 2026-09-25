"""Bring Gift Card backend regression tests."""
import io
import time
import uuid
import requests
from .conftest import API, auth


# --------------------- AUTH ---------------------
def test_auth_me(http, new_customer):
    r = http.get(f"{API}/auth/me", headers=auth(new_customer["token"]), timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert "user" in data and "balance_kobo" in data
    assert isinstance(data["balance_kobo"], int)
    assert data["user"]["email"] == new_customer["email"]


def test_auth_unauth_401(http):
    r = http.get(f"{API}/auth/me", timeout=30)
    assert r.status_code in (401, 403)


def test_login_wrong_password(http, new_customer):
    r = http.post(f"{API}/auth/login", json={"email": new_customer["email"], "password": "wrong"}, timeout=30)
    assert r.status_code == 401


def test_signup_duplicate(http, new_customer):
    r = http.post(f"{API}/auth/signup", json={
        "full_name": "Dup", "email": new_customer["email"], "phone": "+2348011122233",
        "password": "Passw0rd!23"
    }, timeout=30)
    assert r.status_code == 409


def test_password_reset_dev_flow(http):
    email = f"TEST_reset_{uuid.uuid4().hex[:6]}@example.com"
    s = http.post(f"{API}/auth/signup", json={
        "full_name": "Reset U", "email": email, "phone": "+2348000000001", "password": "Passw0rd!23"
    }, timeout=30)
    assert s.status_code == 200
    rr = http.post(f"{API}/auth/password-reset/request", json={"email": email}, timeout=30)
    assert rr.status_code == 200
    token = rr.json().get("dev_token")
    if not token:
        # Production-safe/default behavior: reset tokens are never returned to clients.
        assert "dev_token" not in rr.json()
        return
    c = http.post(f"{API}/auth/password-reset/confirm", json={"token": token, "password": "NewPass!23"}, timeout=30)
    assert c.status_code == 200
    l = http.post(f"{API}/auth/login", json={"email": email, "password": "NewPass!23"}, timeout=30)
    assert l.status_code == 200


# --------------------- CATALOG ---------------------
def test_brands_popular(http):
    r = http.get(f"{API}/brands?popular=true", timeout=30)
    assert r.status_code == 200
    bs = r.json()["brands"]
    assert len(bs) > 0
    assert all(b.get("is_popular") for b in bs)


def test_brands_category_and_search(http):
    r = http.get(f"{API}/brands?category=Gaming", timeout=30)
    assert r.status_code == 200
    assert all(b["category"] == "Gaming" for b in r.json()["brands"])
    r2 = http.get(f"{API}/brands?q=steam", timeout=30)
    assert r2.status_code == 200
    assert any("Steam" in b["name"] for b in r2.json()["brands"])


def test_brand_detail_and_categories(http):
    r = http.get(f"{API}/brands", timeout=30)
    bid = r.json()["brands"][0]["id"]
    d = http.get(f"{API}/brands/{bid}", timeout=30)
    assert d.status_code == 200 and d.json()["id"] == bid
    c = http.get(f"{API}/categories", timeout=30)
    assert c.status_code == 200
    assert "All" in c.json()["categories"]


# --------------------- TRADES ---------------------
def _pick_brand(http):
    return http.get(f"{API}/brands?popular=true", timeout=30).json()["brands"][0]


def test_create_trade_physical_requires_image(http, new_customer):
    b = _pick_brand(http)
    r = http.post(f"{API}/trades", headers=auth(new_customer["token"]), json={
        "brand_id": b["id"], "submission_type": "physical", "card_value_usd": 100, "quantity": 1
    }, timeout=30)
    assert r.status_code == 400


def test_create_trade_ecode_requires_code(http, new_customer):
    b = _pick_brand(http)
    r = http.post(f"{API}/trades", headers=auth(new_customer["token"]), json={
        "brand_id": b["id"], "submission_type": "ecode", "card_value_usd": 100, "quantity": 1
    }, timeout=30)
    assert r.status_code == 400


def test_create_trade_ecode_and_list(http, new_customer):
    b = _pick_brand(http)
    r = http.post(f"{API}/trades", headers=auth(new_customer["token"]), json={
        "brand_id": b["id"], "submission_type": "ecode", "card_value_usd": 50, "quantity": 2,
        "ecode": "XXXX-XXXX-9876", "notes": "TEST trade"
    }, timeout=30)
    assert r.status_code == 200
    t = r.json()
    assert t["status"] == "PENDING_REVIEW"
    assert t["expected_payout_kobo"] == b["rate_kobo_per_usd"] * 50 * 2
    assert "ecode" not in t and "ecode_masked" in t
    tid = t["id"]
    # GET
    g = http.get(f"{API}/trades/{tid}", headers=auth(new_customer["token"]), timeout=30)
    assert g.status_code == 200 and g.json()["id"] == tid
    # list
    l = http.get(f"{API}/trades", headers=auth(new_customer["token"]), timeout=30)
    assert any(x["id"] == tid for x in l.json()["trades"])


# --------------------- ADMIN + IDEMPOTENT APPROVAL ---------------------
def test_admin_approve_idempotent_credits_once(http, new_customer, admin_token):
    b = _pick_brand(http)
    # create trade as customer
    r = http.post(f"{API}/trades", headers=auth(new_customer["token"]), json={
        "brand_id": b["id"], "submission_type": "ecode", "card_value_usd": 25, "quantity": 1,
        "ecode": "EEEE-1111-2222"
    }, timeout=30)
    assert r.status_code == 200
    tid = r.json()["id"]
    expected = r.json()["expected_payout_kobo"]

    # initial balance
    me1 = http.get(f"{API}/auth/me", headers=auth(new_customer["token"]), timeout=30).json()
    b1 = me1["balance_kobo"]

    # approve
    a1 = http.post(f"{API}/admin/trades/{tid}/approve", headers=auth(admin_token), json={"note": "ok"}, timeout=30)
    assert a1.status_code == 200
    assert a1.json()["credited"] is True

    me2 = http.get(f"{API}/auth/me", headers=auth(new_customer["token"]), timeout=30).json()
    b2 = me2["balance_kobo"]
    assert b2 - b1 == expected, f"credit not equal to expected payout: got {b2-b1} want {expected}"

    # attempt second approve -> should be blocked (already approved) and balance unchanged
    a2 = http.post(f"{API}/admin/trades/{tid}/approve", headers=auth(admin_token), json={"note": "again"}, timeout=30)
    assert a2.status_code == 400, f"second approve should be blocked, got {a2.status_code} {a2.text}"

    me3 = http.get(f"{API}/auth/me", headers=auth(new_customer["token"]), timeout=30).json()
    assert me3["balance_kobo"] == b2, "double credit occurred"


def test_admin_need_info_then_reply(http, new_customer, admin_token):
    b = _pick_brand(http)
    r = http.post(f"{API}/trades", headers=auth(new_customer["token"]), json={
        "brand_id": b["id"], "submission_type": "ecode", "card_value_usd": 10, "quantity": 1, "ecode": "AAAA"
    }, timeout=30)
    tid = r.json()["id"]
    n = http.post(f"{API}/admin/trades/{tid}/need-info", headers=auth(admin_token), json={"reason": "clearer image"}, timeout=30)
    assert n.status_code == 200
    rep = http.post(f"{API}/trades/{tid}/reply", headers=auth(new_customer["token"]), json={"message": "here", "ecode": "BBBB-9999"}, timeout=30)
    assert rep.status_code == 200
    assert rep.json()["status"] == "PENDING_REVIEW"


def test_admin_reject(http, new_customer, admin_token):
    b = _pick_brand(http)
    r = http.post(f"{API}/trades", headers=auth(new_customer["token"]), json={
        "brand_id": b["id"], "submission_type": "ecode", "card_value_usd": 5, "quantity": 1, "ecode": "REJ-1"
    }, timeout=30)
    tid = r.json()["id"]
    rj = http.post(f"{API}/admin/trades/{tid}/reject", headers=auth(admin_token), json={"reason": "invalid"}, timeout=30)
    assert rj.status_code == 200
    g = http.get(f"{API}/trades/{tid}", headers=auth(new_customer["token"]), timeout=30)
    assert g.json()["status"] == "REJECTED"


def test_customer_cannot_hit_admin(http, new_customer):
    r = http.get(f"{API}/admin/trades", headers=auth(new_customer["token"]), timeout=30)
    assert r.status_code == 403
    r2 = http.get(f"{API}/admin/stats", headers=auth(new_customer["token"]), timeout=30)
    assert r2.status_code == 403


# --------------------- PAYOUT + WITHDRAWALS ---------------------
def test_payout_accounts_crud_without_unapproved_cap(http, new_customer):
    tok = new_customer["token"]
    created = []
    for i in range(3):
        r = http.post(f"{API}/payout-accounts", headers=auth(tok),
                      json={"provider_name": f"BankTEST{i}", "account_number": f"010101010{i}", "account_name": "TEST U"}, timeout=30)
        assert r.status_code == 200
        created.append(r.json()["id"])
    fourth = http.post(f"{API}/payout-accounts", headers=auth(tok),
                       json={"provider_name": "Bank4", "account_number": "0000000004", "account_name": "TEST U"}, timeout=30)
    assert fourth.status_code == 200
    created.append(fourth.json()["id"])
    d = http.delete(f"{API}/payout-accounts/{created[0]}", headers=auth(tok), timeout=30)
    assert d.status_code == 200
    lst = http.get(f"{API}/payout-accounts", headers=auth(tok), timeout=30).json()["accounts"]
    assert all(a["id"] != created[0] for a in lst)


def test_withdrawal_flow_reserve_and_reverse(http, admin_token):
    # create fresh user + credit via admin approve
    email = f"TEST_wd_{uuid.uuid4().hex[:6]}@example.com"
    s = http.post(f"{API}/auth/signup", json={"full_name":"WD","email":email,"phone":"+2348000000002","password":"Passw0rd!23"}, timeout=30).json()
    tok = s["access_token"]
    b = _pick_brand(http)
    tr = http.post(f"{API}/trades", headers=auth(tok), json={
        "brand_id": b["id"], "submission_type": "ecode", "card_value_usd": 100, "quantity": 1, "ecode": "TEST-CODE"
    }, timeout=30).json()
    tid = tr["id"]
    http.post(f"{API}/admin/trades/{tid}/approve", headers=auth(admin_token), json={"note":"ok"}, timeout=30)
    bal_before = http.get(f"{API}/auth/me", headers=auth(tok), timeout=30).json()["balance_kobo"]
    assert bal_before > 0

    acc = http.post(f"{API}/payout-accounts", headers=auth(tok),
                    json={"provider_name":"TEST Bank","account_number":"0011223344","account_name":"WD User"}, timeout=30).json()

    # Phase 3: set a transaction PIN for the fresh user
    sp = http.post(f"{API}/security/pin", headers=auth(tok), json={"pin": "2581"}, timeout=30)
    assert sp.status_code in (200, 400), sp.text

    # exceed balance
    over = http.post(f"{API}/withdrawals", headers=auth(tok),
                     json={"amount_kobo": bal_before + 1000, "payout_account_id": acc["id"], "narration": "over", "pin": "2581"}, timeout=30)
    assert over.status_code == 400

    # No unapproved minimum-withdrawal policy: a positive amount within balance is accepted.
    tiny = http.post(f"{API}/withdrawals", headers=auth(tok),
                     json={"amount_kobo": 100, "payout_account_id": acc["id"], "pin": "2581"}, timeout=30)
    assert tiny.status_code == 200, tiny.text
    tiny_id = tiny.json()["id"]
    tiny_reject = http.post(f"{API}/admin/withdrawals/{tiny_id}/reject", headers=auth(admin_token),
                            json={"reason": "test cleanup"}, timeout=30)
    assert tiny_reject.status_code == 200, tiny_reject.text

    # valid withdrawal reserves
    amt = 10000 * 100  # 10,000 NGN in kobo
    if amt > bal_before:
        amt = bal_before  # use full balance if smaller
    w = http.post(f"{API}/withdrawals", headers=auth(tok),
                  json={"amount_kobo": amt, "payout_account_id": acc["id"], "narration": "TEST WD", "pin": "2581"}, timeout=30)
    assert w.status_code == 200, w.text
    wid = w.json()["id"]
    bal_after = http.get(f"{API}/auth/me", headers=auth(tok), timeout=30).json()["balance_kobo"]
    assert bal_before - bal_after == amt, "reserve did not debit balance"

    # admin process transition
    p = http.post(f"{API}/admin/withdrawals/{wid}/process", headers=auth(admin_token), timeout=30)
    assert p.status_code == 200
    # reject -> reversal
    rj = http.post(f"{API}/admin/withdrawals/{wid}/reject", headers=auth(admin_token),
                   json={"reason": "unable to process"}, timeout=30)
    assert rj.status_code == 200
    bal_final = http.get(f"{API}/auth/me", headers=auth(tok), timeout=30).json()["balance_kobo"]
    assert bal_final == bal_before, f"reversal did not restore funds: {bal_final} vs {bal_before}"


def test_withdrawal_paid_flow(http, admin_token):
    # need funds + a withdrawal to mark paid
    email = f"TEST_paid_{uuid.uuid4().hex[:6]}@example.com"
    s = http.post(f"{API}/auth/signup", json={"full_name":"P","email":email,"phone":"+2348000000003","password":"Passw0rd!23"}, timeout=30).json()
    tok = s["access_token"]
    b = _pick_brand(http)
    tr = http.post(f"{API}/trades", headers=auth(tok), json={"brand_id": b["id"], "submission_type":"ecode","card_value_usd": 50,"quantity":1,"ecode":"ZZZZ"}, timeout=30).json()
    http.post(f"{API}/admin/trades/{tr['id']}/approve", headers=auth(admin_token), json={"note":"ok"}, timeout=30)
    acc = http.post(f"{API}/payout-accounts", headers=auth(tok), json={"provider_name":"TB","account_number":"9999","account_name":"P"}, timeout=30).json()
    # Phase 3: set PIN for withdrawal
    sp = http.post(f"{API}/security/pin", headers=auth(tok), json={"pin": "2581"}, timeout=30)
    assert sp.status_code in (200, 400), sp.text
    w = http.post(f"{API}/withdrawals", headers=auth(tok), json={"amount_kobo": 100*100*20, "payout_account_id": acc["id"], "pin": "2581"}, timeout=30)
    assert w.status_code == 200
    wid = w.json()["id"]
    p = http.post(f"{API}/admin/withdrawals/{wid}/paid", headers=auth(admin_token), timeout=30)
    assert p.status_code == 200


# --------------------- TRANSACTIONS + NOTIFICATIONS ---------------------
def test_transactions_and_filters(http, new_customer, admin_token):
    tok = new_customer["token"]
    b = _pick_brand(http)
    tr = http.post(f"{API}/trades", headers=auth(tok), json={
        "brand_id": b["id"], "submission_type": "ecode", "card_value_usd": 10,
        "quantity": 1, "ecode": "TX-TEST-CODE"
    }, timeout=30)
    assert tr.status_code == 200, tr.text
    ap = http.post(f"{API}/admin/trades/{tr.json()['id']}/approve", headers=auth(admin_token), json={"note": "ok"}, timeout=30)
    assert ap.status_code == 200, ap.text
    r = http.get(f"{API}/transactions?type=all", headers=auth(tok), timeout=30)
    assert r.status_code == 200
    items = r.json()["transactions"]
    assert any(i["kind"] == "sale" for i in items)
    r2 = http.get(f"{API}/transactions?type=sales&status=Completed", headers=auth(tok), timeout=30)
    assert all(i["kind"] == "sale" and i["status"] == "Completed" for i in r2.json()["transactions"])


def test_notifications(http, new_customer):
    r = http.get(f"{API}/notifications", headers=auth(new_customer["token"]), timeout=30)
    assert r.status_code == 200
    assert "unread" in r.json()
    m = http.post(f"{API}/notifications/read", headers=auth(new_customer["token"]), timeout=30)
    assert m.status_code == 200
    r2 = http.get(f"{API}/notifications", headers=auth(new_customer["token"]), timeout=30)
    assert r2.json()["unread"] == 0


# --------------------- UPLOAD + FILES OWNER-ONLY ---------------------
def test_upload_and_owner_access(http, new_customer, admin_token):
    tok = new_customer["token"]
    # tiny fake png
    img = b"\x89PNG\r\n\x1a\n" + b"0" * 100
    files = {"file": ("t.png", io.BytesIO(img), "image/png")}
    r = requests.post(f"{API}/uploads", headers={"Authorization": f"Bearer {tok}"}, files=files, timeout=60)
    if r.status_code == 502:
        # storage provider might be flaky in preview; skip content check but treat as known
        import pytest
        pytest.skip("object storage unavailable in preview")
    assert r.status_code == 200, r.text
    path = r.json()["path"]
    # owner access
    ok = http.get(f"{API}/files/{path}", headers=auth(tok), timeout=30)
    assert ok.status_code == 200
    # admin can access
    okA = http.get(f"{API}/files/{path}", headers=auth(admin_token), timeout=30)
    assert okA.status_code == 200
    # other user cannot
    other = http.post(f"{API}/auth/signup", json={"full_name":"O","email":f"TEST_other_{uuid.uuid4().hex[:6]}@example.com","phone":"+2348000000004","password":"Passw0rd!23"}, timeout=30).json()
    forb = http.get(f"{API}/files/{path}", headers=auth(other["access_token"]), timeout=30)
    assert forb.status_code == 403
    # unauth
    no = http.get(f"{API}/files/{path}", timeout=30)
    assert no.status_code == 401

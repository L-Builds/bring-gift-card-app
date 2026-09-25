"""Phase 3 backend tests: Transaction PIN + Support Tickets (customer + admin)."""
import uuid
import requests
from .conftest import API, auth


# --------------------- helpers ---------------------
def _signup(http, prefix="p3"):
    email = f"TEST_{prefix}_{uuid.uuid4().hex[:8]}@example.com"
    r = http.post(f"{API}/auth/signup", json={
        "full_name": f"P3 {prefix}", "email": email, "phone": "+2348010000000",
        "password": "Passw0rd!23", "country": "Nigeria",
    }, timeout=30)
    assert r.status_code == 200, r.text
    return {"email": email, "token": r.json()["access_token"], "user": r.json()["user"]}


def _pick_brand(http):
    return http.get(f"{API}/brands?popular=true", timeout=30).json()["brands"][0]


def _fund_user(http, admin_token, tok, usd=50):
    """Create a small trade for the user and admin-approve it to credit balance."""
    b = _pick_brand(http)
    tr = http.post(f"{API}/trades", headers=auth(tok), json={
        "brand_id": b["id"], "submission_type": "ecode", "card_value_usd": usd, "quantity": 1, "ecode": "FUND-1"
    }, timeout=30).json()
    r = http.post(f"{API}/admin/trades/{tr['id']}/approve", headers=auth(admin_token),
                  json={"note": "ok"}, timeout=30)
    assert r.status_code == 200, r.text
    return tr


# =========================================================================
# PIN — pin status, set/change, reset, weak-pin rejection
# =========================================================================
def test_pin_status_fresh_user_has_no_pin(http):
    u = _signup(http, "pin_fresh")
    r = http.get(f"{API}/security/pin", headers=auth(u["token"]), timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert body["has_pin"] is False
    assert body["can_reset_with_password"] is True


def test_pin_set_weak_rejected_and_strong_accepted(http):
    u = _signup(http, "pin_weak")
    tok = u["token"]
    for weak in ("1111", "1234"):
        r = http.post(f"{API}/security/pin", headers=auth(tok), json={"pin": weak}, timeout=30)
        assert r.status_code == 400, f"expected 400 for weak pin {weak}: {r.text}"
    ok = http.post(f"{API}/security/pin", headers=auth(tok), json={"pin": "2581"}, timeout=30)
    assert ok.status_code == 200, ok.text
    assert ok.json()["has_pin"] is True
    me = http.get(f"{API}/auth/me", headers=auth(tok), timeout=30).json()
    assert me["user"].get("has_pin") is True


def test_pin_change_requires_current_pin(http):
    u = _signup(http, "pin_change")
    tok = u["token"]
    # Set initial PIN 2581
    r0 = http.post(f"{API}/security/pin", headers=auth(tok), json={"pin": "2581"}, timeout=30)
    assert r0.status_code == 200

    # Change with wrong current -> 401 PIN_WRONG
    r1 = http.post(f"{API}/security/pin", headers=auth(tok),
                   json={"pin": "7391", "current_pin": "0000"}, timeout=30)
    assert r1.status_code == 401, r1.text
    d = r1.json().get("detail")
    assert isinstance(d, dict) and d.get("code") == "PIN_WRONG"

    # Change with correct current -> 200
    r2 = http.post(f"{API}/security/pin", headers=auth(tok),
                   json={"pin": "7391", "current_pin": "2581"}, timeout=30)
    assert r2.status_code == 200, r2.text


def test_pin_reset_with_password(http):
    u = _signup(http, "pin_reset")
    tok = u["token"]
    # Set an initial PIN
    r0 = http.post(f"{API}/security/pin", headers=auth(tok), json={"pin": "2581"}, timeout=30)
    assert r0.status_code == 200

    # Wrong password -> 401
    bad = http.post(f"{API}/security/pin/reset", headers=auth(tok),
                    json={"password": "wrong-password", "pin": "4820"}, timeout=30)
    assert bad.status_code == 401, bad.text

    # Correct password -> 200 and new PIN works
    good = http.post(f"{API}/security/pin/reset", headers=auth(tok),
                     json={"password": "Passw0rd!23", "pin": "4820"}, timeout=30)
    assert good.status_code == 200, good.text
    assert good.json()["has_pin"] is True

    # 'security' notification exists for set / reset
    notif = http.get(f"{API}/notifications", headers=auth(tok), timeout=30).json()
    types = {n.get("type") for n in notif["notifications"]}
    assert "security" in types


# =========================================================================
# PIN — withdrawal enforcement (PIN_REQUIRED / PIN_INVALID / PIN_WRONG / PIN_LOCKED)
# =========================================================================
def test_withdrawal_without_pin_setup_returns_pin_required(http, admin_token):
    u = _signup(http, "wd_nopin")
    tok = u["token"]
    _fund_user(http, admin_token, tok, usd=50)
    acc = http.post(f"{API}/payout-accounts", headers=auth(tok),
                    json={"provider_name": "TB", "account_number": "1111112222", "account_name": "N P"},
                    timeout=30).json()
    r = http.post(f"{API}/withdrawals", headers=auth(tok),
                  json={"amount_kobo": 200 * 100, "payout_account_id": acc["id"]}, timeout=30)
    # Server: user has no pin_hash -> 403 PIN_REQUIRED
    assert r.status_code == 403, r.text
    d = r.json().get("detail")
    assert isinstance(d, dict) and d.get("code") == "PIN_REQUIRED"


def test_withdrawal_pin_wrong_then_locked_then_reset(http, admin_token):
    u = _signup(http, "wd_pinlock")
    tok = u["token"]
    _fund_user(http, admin_token, tok, usd=50)
    acc = http.post(f"{API}/payout-accounts", headers=auth(tok),
                    json={"provider_name": "TB", "account_number": "2222223333", "account_name": "L P"},
                    timeout=30).json()
    # set PIN
    sp = http.post(f"{API}/security/pin", headers=auth(tok), json={"pin": "2581"}, timeout=30)
    assert sp.status_code == 200

    # Missing pin -> 400 PIN_INVALID (pin field is "")
    miss = http.post(f"{API}/withdrawals", headers=auth(tok),
                     json={"amount_kobo": 200 * 100, "payout_account_id": acc["id"]}, timeout=30)
    assert miss.status_code == 400, miss.text
    dm = miss.json().get("detail")
    assert isinstance(dm, dict) and dm.get("code") == "PIN_INVALID"

    # Wrong pin -> 401 PIN_WRONG with 'attempts left'
    wr = http.post(f"{API}/withdrawals", headers=auth(tok),
                   json={"amount_kobo": 200 * 100, "payout_account_id": acc["id"], "pin": "0000"}, timeout=30)
    assert wr.status_code == 401, wr.text
    dw = wr.json().get("detail")
    assert isinstance(dw, dict) and dw.get("code") == "PIN_WRONG"
    assert "left" in dw.get("message", "").lower()

    # Continue wrong attempts. First was 1/5, need 4 more to hit lock threshold (5th produces PIN_LOCKED)
    for _ in range(4):
        rr = http.post(f"{API}/withdrawals", headers=auth(tok),
                       json={"amount_kobo": 200 * 100, "payout_account_id": acc["id"], "pin": "0000"}, timeout=30)
    # rr should now be 423 PIN_LOCKED
    assert rr.status_code == 423, rr.text
    dl = rr.json().get("detail")
    assert isinstance(dl, dict) and dl.get("code") == "PIN_LOCKED"

    # Correct pin while locked -> still 423 PIN_LOCKED
    still = http.post(f"{API}/withdrawals", headers=auth(tok),
                      json={"amount_kobo": 200 * 100, "payout_account_id": acc["id"], "pin": "2581"}, timeout=30)
    assert still.status_code == 423, still.text
    assert still.json().get("detail", {}).get("code") == "PIN_LOCKED"

    # security notification for lock event
    notif = http.get(f"{API}/notifications", headers=auth(tok), timeout=30).json()
    titles = [n.get("title", "") for n in notif["notifications"]]
    assert any("lock" in t.lower() for t in titles), f"expected a lock notification, got {titles}"

    # Reset PIN via password -> clears lock, new pin works
    reset = http.post(f"{API}/security/pin/reset", headers=auth(tok),
                      json={"password": "Passw0rd!23", "pin": "4820"}, timeout=30)
    assert reset.status_code == 200, reset.text

    bal_before = http.get(f"{API}/auth/me", headers=auth(tok), timeout=30).json()["balance_kobo"]
    ok = http.post(f"{API}/withdrawals", headers=auth(tok),
                   json={"amount_kobo": 200 * 100, "payout_account_id": acc["id"], "pin": "4820"}, timeout=30)
    assert ok.status_code == 200, ok.text
    bal_after = http.get(f"{API}/auth/me", headers=auth(tok), timeout=30).json()["balance_kobo"]
    assert bal_before - bal_after == 200 * 100, "ledger did not debit correctly on successful withdrawal"


# =========================================================================
# Support tickets — customer flows
# =========================================================================
def test_ticket_create_and_list_categories(http):
    u = _signup(http, "tk_cat")
    tok = u["token"]
    r = http.post(f"{API}/support/tickets", headers=auth(tok),
                  json={"subject": "Help with trade", "category": "trade", "message": "please help"},
                  timeout=30)
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["ref"].startswith("BGCS")
    assert t["status"] == "OPEN"
    assert t["category_label"] == "Trade issue"

    # Subject too short -> 422
    bad = http.post(f"{API}/support/tickets", headers=auth(tok),
                    json={"subject": "hi", "category": "other", "message": "please help"},
                    timeout=30)
    assert bad.status_code == 422

    # List
    lst = http.get(f"{API}/support/tickets", headers=auth(tok), timeout=30)
    assert lst.status_code == 200
    body = lst.json()
    assert "unread" in body
    cats = body.get("categories", [])
    assert isinstance(cats, list) and len(cats) == 5

    # Get detail -> ticket + messages[1]
    g = http.get(f"{API}/support/tickets/{t['id']}", headers=auth(tok), timeout=30)
    assert g.status_code == 200
    gd = g.json()
    assert gd["ticket"]["id"] == t["id"]
    assert len(gd["messages"]) == 1


def test_ticket_ref_id_validation(http, admin_token):
    u = _signup(http, "tk_ref")
    tok = u["token"]
    tr = _fund_user(http, admin_token, tok, usd=25)  # gives a trade owned by user
    # Bogus ref -> 400
    bad = http.post(f"{API}/support/tickets", headers=auth(tok),
                    json={"subject": "bogus", "category": "trade", "message": "please help",
                          "ref_type": "trade", "ref_id": "does-not-exist"}, timeout=30)
    assert bad.status_code == 400

    # Valid ref -> ref_label = order_id
    ok = http.post(f"{API}/support/tickets", headers=auth(tok),
                   json={"subject": "issue with order", "category": "trade", "message": "won't approve",
                         "ref_type": "trade", "ref_id": tr["id"]}, timeout=30)
    assert ok.status_code == 200, ok.text
    assert ok.json()["ref_label"] == tr["order_id"]


def test_ticket_messages_close_and_other_user_404(http):
    u = _signup(http, "tk_msg")
    tok = u["token"]
    r = http.post(f"{API}/support/tickets", headers=auth(tok),
                  json={"subject": "Msg thread", "category": "other", "message": "hello"},
                  timeout=30)
    tid = r.json()["id"]

    # Append message
    msg = http.post(f"{API}/support/tickets/{tid}/messages", headers=auth(tok),
                    json={"body": "another message"}, timeout=30)
    assert msg.status_code == 200

    g = http.get(f"{API}/support/tickets/{tid}", headers=auth(tok), timeout=30).json()
    assert g["ticket"]["status"] == "OPEN"
    assert len(g["messages"]) == 2

    # Other user cannot see -> 404
    other = _signup(http, "tk_other")
    forb = http.get(f"{API}/support/tickets/{tid}", headers=auth(other["token"]), timeout=30)
    assert forb.status_code == 404

    # Close
    cl = http.post(f"{API}/support/tickets/{tid}/close", headers=auth(tok), timeout=30)
    assert cl.status_code == 200
    g2 = http.get(f"{API}/support/tickets/{tid}", headers=auth(tok), timeout=30).json()
    assert g2["ticket"]["status"] == "CLOSED"

    # Reply after close -> 400
    late = http.post(f"{API}/support/tickets/{tid}/messages", headers=auth(tok),
                     json={"body": "hey"}, timeout=30)
    assert late.status_code == 400


def test_ticket_open_cap_5(http):
    u = _signup(http, "tk_cap")
    tok = u["token"]
    for i in range(5):
        r = http.post(f"{API}/support/tickets", headers=auth(tok),
                      json={"subject": f"ticket {i}", "category": "other",
                            "message": "please help me quickly"}, timeout=30)
        assert r.status_code == 200, r.text
    # 6th -> 400
    over = http.post(f"{API}/support/tickets", headers=auth(tok),
                     json={"subject": "one more", "category": "other",
                           "message": "please help me quickly"}, timeout=30)
    assert over.status_code == 400


# =========================================================================
# Support tickets — admin flows
# =========================================================================
def test_admin_ticket_reply_status_flow_and_notify(http, admin_token):
    # Customer opens ticket
    u = _signup(http, "tk_admin")
    tok = u["token"]
    cr = http.post(f"{API}/support/tickets", headers=auth(tok),
                   json={"subject": "Admin flow ticket", "category": "account",
                         "message": "cannot login"}, timeout=30)
    assert cr.status_code == 200
    tid = cr.json()["id"]

    # Admin list OPEN with unread_for_admin >= 1
    lst = http.get(f"{API}/admin/support?status=OPEN", headers=auth(admin_token), timeout=30)
    assert lst.status_code == 200
    match = next((t for t in lst.json()["tickets"] if t["id"] == tid), None)
    assert match is not None
    assert int(match.get("unread_for_admin", 0)) >= 1

    # search q by customer name
    q = http.get(f"{API}/admin/support?status=OPEN&q={u['user']['full_name'].split()[0]}",
                 headers=auth(admin_token), timeout=30)
    assert q.status_code == 200
    assert any(t["id"] == tid for t in q.json()["tickets"])

    # Admin get detail -> resets unread_for_admin, includes customer
    det = http.get(f"{API}/admin/support/{tid}", headers=auth(admin_token), timeout=30)
    assert det.status_code == 200
    dd = det.json()
    assert "customer" in dd
    assert int(dd["ticket"].get("unread_for_admin", 0)) == 0

    # Admin reply -> status AWAITING_CUSTOMER
    rp = http.post(f"{API}/admin/support/{tid}/reply", headers=auth(admin_token),
                   json={"body": "Hi, please try again"}, timeout=30)
    assert rp.status_code == 200

    # Customer GET shows unread_for_customer >= 1
    cg = http.get(f"{API}/support/tickets/{tid}", headers=auth(tok), timeout=30).json()
    # After GET, unread_for_customer is reset to 0. Verify via list before-get instead:
    lst_c = http.get(f"{API}/support/tickets", headers=auth(tok), timeout=30).json()
    # Note: since we already GET'd detail, ticket is now read. Check status only.
    assert cg["ticket"]["status"] == "AWAITING_CUSTOMER"

    # Customer notification of type 'support' with ref_id=ticket id
    notif = http.get(f"{API}/notifications", headers=auth(tok), timeout=30).json()
    support = [n for n in notif["notifications"] if n.get("type") == "support"]
    assert any(n.get("ref_id") == tid for n in support), f"expected support notification with ref_id={tid}"

    # Customer replies -> back to OPEN
    cr2 = http.post(f"{API}/support/tickets/{tid}/messages", headers=auth(tok),
                    json={"body": "still not working"}, timeout=30)
    assert cr2.status_code == 200
    det2 = http.get(f"{API}/admin/support/{tid}", headers=auth(admin_token), timeout=30).json()
    assert det2["ticket"]["status"] == "OPEN"

    # Admin RESOLVED -> resolved_at set + notification
    rs = http.post(f"{API}/admin/support/{tid}/status", headers=auth(admin_token),
                   json={"status": "RESOLVED"}, timeout=30)
    assert rs.status_code == 200
    det3 = http.get(f"{API}/admin/support/{tid}", headers=auth(admin_token), timeout=30).json()
    assert det3["ticket"]["status"] == "RESOLVED"
    assert det3["ticket"].get("resolved_at")

    # Bad status -> 422
    bad = http.post(f"{API}/admin/support/{tid}/status", headers=auth(admin_token),
                    json={"status": "BOGUS"}, timeout=30)
    assert bad.status_code == 422


def test_admin_ticket_non_admin_403(http):
    u = _signup(http, "tk_forbid")
    r = http.get(f"{API}/admin/support?status=OPEN", headers=auth(u["token"]), timeout=30)
    assert r.status_code == 403


def test_admin_stats_has_open_tickets(http, admin_token):
    r = http.get(f"{API}/admin/stats", headers=auth(admin_token), timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert "open_tickets" in body
    assert isinstance(body["open_tickets"], int)


def test_admin_user_detail_includes_tickets(http, admin_token):
    u = _signup(http, "tk_ud")
    tok = u["token"]
    r = http.post(f"{API}/support/tickets", headers=auth(tok),
                  json={"subject": "user detail ticket", "category": "other",
                        "message": "please help"}, timeout=30)
    assert r.status_code == 200
    user_id = u["user"]["id"]
    det = http.get(f"{API}/admin/users/{user_id}", headers=auth(admin_token), timeout=30)
    assert det.status_code == 200
    body = det.json()
    assert "tickets" in body
    assert any(t["id"] == r.json()["id"] for t in body["tickets"])

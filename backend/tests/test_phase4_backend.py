"""Phase 4/7 backend tests: referral tracking without unapproved rewards, and removed scope."""
import uuid
from .conftest import API, auth


def _signup(http, prefix="p4", referral_code: str = ""):
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "full_name": f"P4 Ref {prefix} {suffix[:4]}",
        "email": f"TEST_{prefix}_{suffix}@example.com",
        "phone": f"+23480{int(suffix[:6], 16) % 100000000:08d}",
        "password": "Passw0rd!23",
        "country": "Nigeria",
    }
    if referral_code:
        payload["referral_code"] = referral_code
    return http.post(f"{API}/auth/signup", json=payload, timeout=30)


def _pick_brand(http):
    return http.get(f"{API}/brands?popular=true", timeout=30).json()["brands"][0]


def _create_and_approve_trade(http, admin_token, tok, usd=10):
    b = _pick_brand(http)
    tr = http.post(f"{API}/trades", headers=auth(tok), json={
        "brand_id": b["id"], "submission_type": "ecode", "card_value_usd": usd,
        "quantity": 1, "ecode": f"E-{uuid.uuid4().hex[:6]}",
    }, timeout=30)
    assert tr.status_code == 200, tr.text
    body = tr.json()
    expected = int(body.get("expected_payout_kobo") or 0)
    ap = http.post(f"{API}/admin/trades/{body['id']}/approve", headers=auth(admin_token), json={"note": "ok"}, timeout=30)
    assert ap.status_code == 200, ap.text
    return body, expected


def test_signup_with_unknown_referral_code_400(http):
    r = _signup(http, "sig_bad", referral_code="NOPE")
    assert r.status_code == 400, r.text
    assert "not found" in r.text.lower()


def test_referral_tracks_link_without_wallet_reward(http, admin_token):
    owner_signup = _signup(http, "owner")
    assert owner_signup.status_code == 200, owner_signup.text
    owner = owner_signup.json()
    owner_token = owner["access_token"]
    owner_ref = http.get(f"{API}/referral", headers=auth(owner_token), timeout=30).json()
    code = owner_ref["code"]

    r = _signup(http, "sig_ok", referral_code=code)
    assert r.status_code == 200, r.text
    body = r.json()
    tok = body["access_token"]

    ref = http.get(f"{API}/referral", headers=auth(tok), timeout=30)
    assert ref.status_code == 200, ref.text
    rb = ref.json()
    assert rb["referred_by_name"]
    assert rb["can_apply_code"] is False
    for removed in ("rewarded_count", "total_earned_kobo", "referrer_bonus_kobo", "referee_bonus_kobo"):
        assert removed not in rb

    before = http.get(f"{API}/auth/me", headers=auth(tok), timeout=30).json()["balance_kobo"]
    _, expected = _create_and_approve_trade(http, admin_token, tok, usd=10)
    after = http.get(f"{API}/auth/me", headers=auth(tok), timeout=30).json()["balance_kobo"]
    assert after - before == expected, "trade approval must credit only the approved trade payout"

    notifications = http.get(f"{API}/notifications", headers=auth(tok), timeout=30).json()["notifications"]
    assert not any(n.get("type") == "reward" for n in notifications)

    tx = http.get(f"{API}/transactions?type=all", headers=auth(tok), timeout=30).json()["transactions"]
    assert not any(i.get("kind") == "reward" for i in tx)

    owner_after = http.get(f"{API}/referral", headers=auth(owner_token), timeout=30).json()
    assert any(x["id"] == body["user"]["id"] for x in owner_after["referred"])


def test_referral_apply_once_without_reward_timing_rule(http, admin_token):
    r = _signup(http, "apply")
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    ref = http.get(f"{API}/referral", headers=auth(tok), timeout=30).json()
    assert ref["can_apply_code"] is True

    own = http.post(f"{API}/referral/apply", headers=auth(tok), json={"code": ref["code"]}, timeout=30)
    assert own.status_code == 400
    unknown = http.post(f"{API}/referral/apply", headers=auth(tok), json={"code": "NOPE"}, timeout=30)
    assert unknown.status_code == 400

    # Approval of a trade must not create a referral bonus or prevent later one-time linking.
    _create_and_approve_trade(http, admin_token, tok, usd=10)
    owner_signup = _signup(http, "apply_owner")
    assert owner_signup.status_code == 200, owner_signup.text
    owner_tok = owner_signup.json()["access_token"]
    owner_code = http.get(f"{API}/referral", headers=auth(owner_tok), timeout=30).json()["code"]
    linked = http.post(f"{API}/referral/apply", headers=auth(tok), json={"code": owner_code}, timeout=30)
    assert linked.status_code == 200, linked.text
    again = http.post(f"{API}/referral/apply", headers=auth(tok), json={"code": owner_code}, timeout=30)
    assert again.status_code == 400


def test_removed_rate_follow_and_broadcast_routes_are_not_available(http, admin_token):
    r = _signup(http, "removed")
    assert r.status_code == 200
    tok = r.json()["access_token"]
    b = _pick_brand(http)

    assert http.get(f"{API}/follows", headers=auth(tok), timeout=30).status_code == 404
    assert http.post(f"{API}/brands/{b['id']}/follow", headers=auth(tok), timeout=30).status_code == 404
    assert http.get(f"{API}/admin/broadcasts", headers=auth(admin_token), timeout=30).status_code == 404
    assert http.post(f"{API}/admin/broadcasts", headers=auth(admin_token), json={"title": "x", "body": "y"}, timeout=30).status_code == 404


def test_admin_brand_payload_has_no_follower_alert_metadata(http, admin_token):
    r = http.get(f"{API}/admin/brands", headers=auth(admin_token), timeout=30)
    assert r.status_code == 200, r.text
    assert all("followers" not in b and "followers_notified" not in b for b in r.json()["brands"])

"""Self-service admin password and session security."""
import uuid

import pytest

from tests.pg_support import s


def headers(token):
    return {"Authorization": "Bearer " + token}


@pytest.mark.asyncio(loop_scope="session")
async def test_admin_can_change_own_password_and_keep_current_session(http):
    suffix = uuid.uuid4().hex[:10]
    email = f"security-manager-{suffix}@example.com"
    old_password = "OldManagerSecret!42@admin"
    user = {
        "id": uuid.uuid4().hex,
        "full_name": "Security Manager",
        "email": email,
        "phone": "",
        "password_hash": s.hash_pw(old_password),
        "role": "admin",
        "staff_role": "manager",
        "staff_permissions": [],
        "disabled": False,
        "created_at": s.now(),
        "token_version": 0,
    }
    await s.db.users.insert_one(user)

    login = await http.post("/api/auth/login", json={"email": email, "password": old_password})
    assert login.status_code == 200, login.text
    old_token = login.json()["access_token"]
    old_auth = headers(old_token)

    wrong_current = await http.post("/api/auth/password/change", headers=old_auth, json={
        "current_password": "WrongPassword@admin",
        "new_password": "FreshManagerSecret!42@admin",
    })
    assert wrong_current.status_code == 401

    bad_suffix = await http.post("/api/auth/password/change", headers=old_auth, json={
        "current_password": old_password,
        "new_password": "FreshManagerSecret!42",
    })
    assert bad_suffix.status_code == 422

    same_password = await http.post("/api/auth/password/change", headers=old_auth, json={
        "current_password": old_password,
        "new_password": old_password,
    })
    assert same_password.status_code == 422

    new_password = "FreshManagerSecret!42@admin"
    changed = await http.post("/api/auth/password/change", headers=old_auth, json={
        "current_password": old_password,
        "new_password": new_password,
    })
    assert changed.status_code == 200, changed.text
    body = changed.json()
    assert body["user"]["role"] == "admin"
    assert body["user"]["staff_role"] == "manager"
    assert body.get("access_token")
    new_auth = headers(body["access_token"])

    # The token used before the password rotation is invalid, while the fresh
    # token returned to this device keeps the signed-in admin working.
    assert (await http.get("/api/auth/me", headers=old_auth)).status_code == 401
    assert (await http.get("/api/auth/me", headers=new_auth)).status_code == 200
    assert (await http.post("/api/auth/login", json={"email": email, "password": old_password})).status_code == 401
    assert (await http.post("/api/auth/login", json={"email": email, "password": new_password})).status_code == 200


@pytest.mark.asyncio(loop_scope="session")
async def test_admin_can_revoke_other_sessions_without_logging_out_current_device(http):
    suffix = uuid.uuid4().hex[:10]
    email = f"session-manager-{suffix}@example.com"
    password = "SessionManagerSecret!42@admin"
    user = {
        "id": uuid.uuid4().hex,
        "full_name": "Session Manager",
        "email": email,
        "phone": "",
        "password_hash": s.hash_pw(password),
        "role": "admin",
        "staff_role": "manager",
        "staff_permissions": [],
        "disabled": False,
        "created_at": s.now(),
        "token_version": 0,
    }
    await s.db.users.insert_one(user)

    first = await http.post("/api/auth/login", json={"email": email, "password": password})
    second = await http.post("/api/auth/login", json={"email": email, "password": password})
    assert first.status_code == second.status_code == 200
    first_auth = headers(first.json()["access_token"])
    second_auth = headers(second.json()["access_token"])

    wrong = await http.post("/api/auth/sessions/revoke-others", headers=first_auth, json={
        "current_password": "WrongPassword@admin",
    })
    assert wrong.status_code == 401

    revoked = await http.post("/api/auth/sessions/revoke-others", headers=first_auth, json={
        "current_password": password,
    })
    assert revoked.status_code == 200, revoked.text
    fresh_auth = headers(revoked.json()["access_token"])

    assert (await http.get("/api/auth/me", headers=first_auth)).status_code == 401
    assert (await http.get("/api/auth/me", headers=second_auth)).status_code == 401
    assert (await http.get("/api/auth/me", headers=fresh_auth)).status_code == 200
    assert (await http.post("/api/auth/login", json={"email": email, "password": password})).status_code == 200


@pytest.mark.asyncio(loop_scope="session")
async def test_admin_notification_preference_is_self_service_for_all_staff_roles(http):
    suffix = uuid.uuid4().hex[:10]
    password = "WorkerPreference!42@admin"
    worker = {
        "id": uuid.uuid4().hex,
        "full_name": "Preference Worker",
        "email": f"preference-worker-{suffix}@example.com",
        "phone": "",
        "password_hash": s.hash_pw(password),
        "role": "admin",
        "staff_role": "worker",
        "staff_permissions": ["support"],
        "notifications_enabled": True,
        "disabled": False,
        "created_at": s.now(),
        "token_version": 0,
    }
    await s.db.users.insert_one(worker)
    login = await http.post("/api/auth/login", json={"email": worker["email"], "password": password})
    assert login.status_code == 200, login.text
    auth = headers(login.json()["access_token"])

    off = await http.patch("/api/auth/admin-notifications", headers=auth, json={"notifications_enabled": False})
    assert off.status_code == 200, off.text
    assert off.json()["user"]["notifications_enabled"] is False
    assert (await http.get("/api/auth/me", headers=auth)).json()["user"]["notifications_enabled"] is False

    on = await http.patch("/api/auth/admin-notifications", headers=auth, json={"notifications_enabled": True})
    assert on.status_code == 200, on.text
    assert on.json()["user"]["notifications_enabled"] is True

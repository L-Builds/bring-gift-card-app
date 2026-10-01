"""Company staff access is enforced by the API and PostgreSQL, not by the UI."""
import uuid

import pytest

from persistence import DuplicateKeyError
from tests.pg_support import s

def headers(token):
    return {"Authorization": "Bearer " + token}


@pytest.mark.asyncio(loop_scope="session")
async def test_staff_hierarchy_password_rule_and_scope_revocation(http):
    suffix = uuid.uuid4().hex[:10]
    gm_email = f"gm-{suffix}@example.com"
    gm_password = "LongSecret!42@admin"
    gm = {
        "id": uuid.uuid4().hex, "full_name": "Test General Manager", "email": gm_email,
        "phone": "", "password_hash": s.hash_pw(gm_password), "role": "admin",
        "staff_role": "general_manager", "staff_permissions": [], "disabled": False,
        "created_at": s.now(), "token_version": 0,
    }
    await s.db.users.insert_one(gm)
    with pytest.raises(DuplicateKeyError):
        await s.db.users.insert_one({**gm, "id": uuid.uuid4().hex, "email": f"second-{suffix}@example.com"})

    gm_login = await http.post("/api/auth/login", json={"email": gm_email, "password": gm_password})
    assert gm_login.status_code == 200, gm_login.text
    assert gm_login.json()["user"]["staff_role"] == "general_manager"
    gm_auth = headers(gm_login.json()["access_token"])
    assert (await http.get("/api/admin/staff", headers=gm_auth)).status_code == 200

    manager_email = f"manager-{suffix}@example.com"
    manager_password = "ManagerSecret!42@admin"
    create_manager = await http.post("/api/admin/staff", headers=gm_auth, json={
        "full_name": "Test Manager", "email": manager_email, "password": manager_password,
        "staff_role": "manager",
    })
    assert create_manager.status_code == 200, create_manager.text
    manager_id = create_manager.json()["staff"]["id"]
    assert "password" not in create_manager.json()["staff"]
    manager_login = await http.post("/api/auth/login", json={"email": manager_email, "password": manager_password})
    assert manager_login.status_code == 200
    manager_auth = headers(manager_login.json()["access_token"])

    bad_suffix = await http.post("/api/admin/staff", headers=manager_auth, json={
        "full_name": "Bad Password", "email": f"bad-{suffix}@example.com",
        "password": "LongSecretWithoutSuffix", "staff_role": "worker", "staff_permissions": ["support"],
    })
    assert bad_suffix.status_code == 422
    create_manager_denied = await http.post("/api/admin/staff", headers=manager_auth, json={
        "full_name": "Unauthorized Manager", "email": f"denied-{suffix}@example.com",
        "password": gm_password, "staff_role": "manager",
    })
    assert create_manager_denied.status_code == 403

    worker_email = f"worker-{suffix}@example.com"
    worker_password = "WorkerSecret!42@admin"
    create_worker = await http.post("/api/admin/staff", headers=manager_auth, json={
        "full_name": "Test Worker", "email": worker_email, "password": worker_password,
        "staff_role": "worker", "staff_permissions": ["support"],
    })
    assert create_worker.status_code == 200, create_worker.text
    worker_id = create_worker.json()["staff"]["id"]
    for n in range(3):
        extra = await http.post("/api/admin/staff", headers=manager_auth, json={
            "full_name": f"Extra Worker {n}", "email": f"worker-{n}-{suffix}@example.com",
            "password": worker_password, "staff_role": "worker", "staff_permissions": [],
        })
        assert extra.status_code == 200, extra.text
    page1 = (await http.get("/api/admin/staff?page=1&page_size=2", headers=manager_auth)).json()
    page2 = (await http.get("/api/admin/staff?page=2&page_size=2", headers=manager_auth)).json()
    assert page1["total"] >= 4 and len(page1["staff"]) == len(page2["staff"]) == 2
    assert {u["id"] for u in page1["staff"]}.isdisjoint({u["id"] for u in page2["staff"]})
    assert all(u["staff_role"] == "worker" for u in page1["staff"] + page2["staff"])
    searched = (await http.get(f"/api/admin/staff?q={worker_email}", headers=manager_auth)).json()
    assert searched["total"] == 1 and searched["staff"][0]["id"] == worker_id

    worker_login = await http.post("/api/auth/login", json={"email": worker_email, "password": worker_password})
    assert worker_login.status_code == 200
    assert worker_login.json()["user"]["staff_permissions"] == ["support"]
    worker_auth = headers(worker_login.json()["access_token"])
    assert (await http.get("/api/auth/me", headers=worker_auth)).json()["user"]["staff_role"] == "worker"
    assert (await http.get("/api/admin/support", headers=worker_auth)).status_code == 200
    for path in ("/api/admin/trades", "/api/admin/withdrawals", "/api/admin/users",
                 "/api/admin/staff", "/api/admin/brands", "/api/admin/markets",
                 "/api/admin/card-rates?brand_id=x", "/api/admin/payout-providers",
                 "/api/admin/readiness"):
        denied = await http.get(path, headers=worker_auth)
        assert denied.status_code == 403, (path, denied.status_code, denied.text)
    assert (await http.post("/api/admin/markets", headers=worker_auth, json={
        "code": "ZZ", "name": "Blocked Market", "currency": "USD",
    })).status_code == 403
    worker_stats = await http.get("/api/admin/stats", headers=worker_auth)
    assert worker_stats.status_code == 200, worker_stats.text
    assert worker_stats.json()["pending_trades"] == 0
    assert worker_stats.json()["pending_withdrawals"] == 0
    assert worker_stats.json()["total_customers"] == 0
    assert worker_stats.json()["total_brands"] == 0
    assert (await http.get("/api/admin/kyc", headers=worker_auth)).status_code == 404  # KYC is deferred globally.

    assert (await http.patch(f"/api/admin/staff/{manager_id}", headers=manager_auth,
                             json={"disabled": True})).status_code == 403
    assert (await http.patch(f"/api/admin/staff/{gm['id']}", headers=manager_auth,
                             json={"disabled": True})).status_code == 403
    granted = await http.patch(f"/api/admin/staff/{worker_id}", headers=manager_auth,
                               json={"staff_permissions": ["customers", "trades"]})
    assert granted.status_code == 200, granted.text
    assert granted.json()["staff"]["staff_permissions"] == ["customers", "trades"]
    assert (await http.get("/api/admin/support", headers=worker_auth)).status_code == 401
    worker_relogin = await http.post("/api/auth/login", json={"email": worker_email, "password": worker_password})
    worker_auth = headers(worker_relogin.json()["access_token"])
    assert (await http.get("/api/admin/trades", headers=worker_auth)).status_code == 200
    assert (await http.get("/api/admin/users", headers=worker_auth)).status_code == 200
    assert (await http.get("/api/admin/support", headers=worker_auth)).status_code == 403
    assert (await http.get("/api/admin/withdrawals", headers=worker_auth)).status_code == 403

    invalid_rotation = await http.patch(f"/api/admin/staff/{worker_id}", headers=manager_auth,
                                        json={"password": "PasswordWithoutSuffix"})
    assert invalid_rotation.status_code == 422
    worker_password = "RotatedWorker!42@admin"
    rotated = await http.patch(f"/api/admin/staff/{worker_id}", headers=manager_auth,
                               json={"password": worker_password})
    assert rotated.status_code == 200 and "password" not in rotated.json()["staff"]
    assert (await http.get("/api/admin/trades", headers=worker_auth)).status_code == 401
    worker_auth = headers((await http.post("/api/auth/login", json={"email": worker_email,
                                                                   "password": worker_password})).json()["access_token"])

    reset = await http.post("/api/auth/password-reset/request", json={"email": manager_email})
    assert reset.status_code == 200 and reset.json().get("dev_token")
    token = reset.json()["dev_token"]
    bad_reset = await http.post("/api/auth/password-reset/confirm", json={
        "token": token, "password": "LongSecretWithoutSuffix",
    })
    assert bad_reset.status_code == 422
    new_manager_password = "NewManagerSecret@admin"
    good_reset = await http.post("/api/auth/password-reset/confirm", json={
        "token": token, "password": new_manager_password,
    })
    assert good_reset.status_code == 200, good_reset.text
    assert (await http.get("/api/admin/staff", headers=manager_auth)).status_code == 401
    assert (await http.post("/api/auth/login", json={"email": manager_email,
                                                     "password": new_manager_password})).status_code == 200
    assert (await http.post("/api/auth/login", json={"email": manager_email,
                                                     "password": manager_password})).status_code == 401

    await s.db.users.insert_one({
        "id": uuid.uuid4().hex, "full_name": "Legacy Bad Admin", "email": f"legacy-{suffix}@example.com",
        "phone": "", "password_hash": s.hash_pw("LegacyPassword123"), "role": "admin",
        "staff_role": "manager", "disabled": False, "created_at": s.now(),
    })
    assert (await http.post("/api/auth/login", json={"email": f"legacy-{suffix}@example.com",
                                                     "password": "LegacyPassword123"})).status_code == 401

    disabled = await http.patch(f"/api/admin/staff/{worker_id}", headers=gm_auth, json={"disabled": True})
    assert disabled.status_code == 200
    assert (await http.get("/api/admin/trades", headers=worker_auth)).status_code == 401
    assert (await http.post("/api/auth/login", json={"email": worker_email,
                                                     "password": worker_password})).status_code == 401


def test_every_admin_route_has_server_dependency():
    routes = []
    for entry in s.app.routes:
        routes.extend(entry.original_router.routes if hasattr(entry, "original_router") else [entry])
    admin_routes = [route for route in routes if getattr(route, "path", "").startswith("/api/admin")]
    assert admin_routes
    for route in admin_routes:
        dependencies = [dependency.call for dependency in route.dependant.dependencies]
        assert any(call in {s.require_admin, s.require_staff} or getattr(call, "__name__", "") == "check"
                   for call in dependencies), route.path


@pytest.mark.asyncio(loop_scope="session")
async def test_withdrawal_worker_can_read_only_payout_choices(http):
    worker = {
        "id": uuid.uuid4().hex, "full_name": "Withdrawal Worker",
        "email": f"withdrawals-{uuid.uuid4().hex}@example.com", "phone": "",
        "password_hash": s.hash_pw("WorkerSecret!42@admin"), "role": "admin",
        "staff_role": "worker", "staff_permissions": ["withdrawals"],
        "disabled": False, "created_at": s.now(), "token_version": 0,
    }
    await s.db.users.insert_one(worker)
    auth = headers(s.make_token(worker))
    choices = await http.get("/api/admin/withdrawal-provider-options", headers=auth)
    assert choices.status_code == 200, choices.text
    assert choices.json()["providers"][0]["id"] == "manual"
    assert all(set(row) <= {"id", "label", "enabled", "available"}
               for row in choices.json()["providers"])
    assert (await http.get("/api/admin/payout-providers", headers=auth)).status_code == 403
    assert (await http.post("/api/admin/payout-providers/test", headers=auth, json={})).status_code == 403

"""Customer deletion preserves the ledger while removing account access and profile data."""
import asyncio
import uuid

import pytest

from tests.pg_support import s
from botocore.exceptions import ClientError
import private_services

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def customer(password="DeleteCustomer!42"):
    user_id = uuid.uuid4().hex
    user = {
        "id": user_id, "full_name": "Deletion Customer", "email": f"{user_id}@example.com",
        "phone": "+234" + str(int(user_id[:11], 16))[:10], "role": "customer",
        "password_hash": s.hash_pw(password) if password else None,
        "pin_hash": s.hash_pw("1234"), "picture": "https://example.com/photo.png",
        "currency": "NGN", "market_code": "NG", "minor_digits": 2,
        "referral_code": "BGC" + user_id[:12].upper(), "disabled": False,
        "token_version": 0, "created_at": s.now(),
    }
    await s.db.users.insert_one(user)
    return user, {"Authorization": "Bearer " + s.make_token(user)}


async def test_clean_customer_deletion_anonymizes_profile_and_keeps_financial_records(http, actors):
    user, auth = await customer()
    uid = user["id"]
    account_id, withdrawal_id, trade_id = (uuid.uuid4().hex for _ in range(3))
    path = f"bring-gift-card/uploads/{uid}/{uuid.uuid4().hex}.jpg"
    await s.db.payout_accounts.insert_one({
        "id": account_id, "user_id": uid, "currency": "NGN", "account_number": "1234567890",
        "account_name": user["full_name"], "provider_name": "Test Bank", "bank_code": "001",
        "verified": True, "created_at": s.now(), "deleted_at": None,
    })
    await s.db.trades.insert_one({
        "id": trade_id, "user_id": uid, "status": "APPROVED", "currency": "NGN",
        "expected_payout_kobo": 1000, "approved_payout_kobo": 1000,
        "image_paths": [path], "created_at": s.now(),
    })
    await s.db.uploads.insert_one({"path": path, "user_id": uid, "created_at": s.now()})
    await s.db.withdrawals.insert_one({
        "id": withdrawal_id, "user_id": uid, "payout_account_id": account_id,
        "amount_kobo": 1000, "status": "PAID", "currency": "NGN",
        "destination": {"account_number": "1234567890", "account_name": user["full_name"]},
        "created_at": s.now(),
    })
    for amount in (1000, -1000):
        await s.db.ledger.insert_one({"id": uuid.uuid4().hex, "user_id": uid,
            "dedup_key": uuid.uuid4().hex, "type": "TEST", "amount_kobo": amount,
            "currency": "NGN", "created_at": s.now()})
    await s.db.notifications.insert_one({"id": uuid.uuid4().hex, "user_id": uid,
                                         "title": "Test alert", "created_at": s.now()})
    await s.db.password_resets.insert_one({"id": uuid.uuid4().hex, "user_id": uid,
                                           "token_hash": uuid.uuid4().hex, "expires_at": s.now()})
    ticket_id = uuid.uuid4().hex
    await s.db.support_tickets.insert_one({"id": ticket_id, "user_id": uid,
        "customer_name": user["full_name"], "customer_email": user["email"],
        "last_message_preview": "Customer requested help", "status": "CLOSED", "category": "trade",
        "ref_type": "trade", "ref_id": trade_id})
    await s.db.support_messages.insert_one({"id": uuid.uuid4().hex, "ticket_id": ticket_id,
        "sender": "customer", "sender_name": user["full_name"], "body": "Help with payment"})

    assert (await http.get("/api/account-deletion", headers=auth)).json() == {
        "status": "none", "requires_password": True,
    }
    assert (await http.post("/api/account-deletion", headers=auth,
                            json={"confirmation": "wrong", "password": "DeleteCustomer!42"})).status_code == 422
    assert (await http.post("/api/account-deletion", headers=auth,
                            json={"confirmation": "DELETE", "password": "wrong"})).status_code == 401
    response = await http.post("/api/account-deletion", headers=auth,
                               json={"confirmation": "DELETE", "password": "DeleteCustomer!42"})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["status"] == "completed" and result["reference"] and result["requires_password"]
    assert (await http.get("/api/auth/me", headers=auth)).status_code == 401
    assert (await http.post("/api/auth/login", json={"email": user["email"],
                             "password": "DeleteCustomer!42"})).status_code == 401
    stored = await s.db.users.find_one({"id": uid})
    assert stored["disabled"] is True and stored["token_version"] == 1
    assert stored["full_name"] == "Deleted customer"
    assert stored["email"].endswith("@accounts.bringgiftcard.invalid")
    assert stored.get("phone") in (None, "")
    for key in ("password_hash", "pin_hash", "picture", "referral_code", "auth_provider"):
        assert not stored.get(key), key
    assert await s.db.account_deletion_requests.count_documents({"user_id": uid}) == 1
    assert not await s.db.notifications.count_documents({"user_id": uid})
    assert not await s.db.password_resets.count_documents({"user_id": uid})
    payout = await s.db.payout_accounts.find_one({"id": account_id})
    assert payout["deleted_at"] and not payout.get("account_number")
    assert not payout.get("account_name") and not payout.get("provider_name")
    ticket = await s.db.support_tickets.find_one({"id": ticket_id})
    message = await s.db.support_messages.find_one({"ticket_id": ticket_id})
    assert ticket["customer_name"] == "Deleted customer" and ticket["customer_email"] == ""
    assert message["sender_name"] == "Deleted customer" and message["body"] == "Help with payment"
    assert await s.db.trades.find_one({"id": trade_id})
    assert await s.db.withdrawals.find_one({"id": withdrawal_id})
    assert await s.db.ledger.count_documents({"user_id": uid}) == 2
    assert await s.db.uploads.find_one({"path": path})  # retained trade evidence


async def test_pending_request_then_management_finalization_after_obligations_resolve(http, actors):
    user, auth = await customer()
    trade_id = uuid.uuid4().hex
    await s.db.trades.insert_one({"id": trade_id, "user_id": user["id"],
        "status": "PENDING_REVIEW", "currency": "NGN", "expected_payout_kobo": 1000})
    requested = await http.post("/api/account-deletion", headers=auth,
        json={"confirmation": "DELETE", "password": "DeleteCustomer!42"})
    assert requested.status_code == 200, requested.text
    pending = requested.json()
    assert pending["status"] == "pending_review" and "trade" in pending["reason"].lower()
    assert (await http.get("/api/auth/me", headers=auth)).status_code == 200
    assert (await http.get("/api/account-deletion", headers=auth)).json()["reference"] == pending["reference"]
    repeated = await http.post("/api/account-deletion", headers=auth,
        json={"confirmation": "DELETE", "password": "DeleteCustomer!42"})
    assert repeated.json()["reference"] == pending["reference"]
    assert await s.db.account_deletion_requests.count_documents({"user_id": user["id"]}) == 1
    assert (await http.get("/api/admin/account-deletion", headers=actors[3])).status_code == 200
    blocked = await http.post(f"/api/admin/account-deletion/{pending['reference']}/finalize", headers=actors[3])
    assert blocked.status_code == 200 and blocked.json()["status"] == "pending_review"
    await s.db.trades.update_one({"id": trade_id}, {"$set": {"status": "REJECTED"}})
    completed = await http.post(f"/api/admin/account-deletion/{pending['reference']}/finalize", headers=actors[3])
    assert completed.status_code == 200 and completed.json()["status"] == "completed"
    assert (await http.get("/api/auth/me", headers=auth)).status_code == 401
    repeat = await http.post(f"/api/admin/account-deletion/{pending['reference']}/finalize", headers=actors[3])
    assert repeat.status_code == 200 and repeat.json()["status"] == "completed"


async def test_unlinked_upload_requires_manual_privacy_review_and_admins_cannot_self_delete(http, actors):
    user, auth = await customer()
    path = f"bring-gift-card/uploads/{user['id']}/{uuid.uuid4().hex}.jpg"
    await s.db.uploads.insert_one({"path": path, "user_id": user["id"], "created_at": s.now()})
    pending = await http.post("/api/account-deletion", headers=auth,
        json={"confirmation": "DELETE", "password": "DeleteCustomer!42"})
    assert pending.status_code == 200 and pending.json()["status"] == "pending_review"
    assert "uploaded files" in pending.json()["reason"].lower()
    assert (await http.get("/api/account-deletion", headers=actors[3])).status_code == 403
    assert (await http.post("/api/account-deletion", headers=actors[3],
        json={"confirmation": "DELETE", "password": "test-password-123@admin"})).status_code == 403
    assert not await s.db.account_deletion_requests.find_one({"user_id": actors[1]["id"]})
    worker = {"id": uuid.uuid4().hex, "email": uuid.uuid4().hex + "@example.com",
              "full_name": "Worker", "role": "admin", "staff_role": "worker",
              "staff_permissions": ["customers"], "password_hash": s.hash_pw("WorkerSecret!42@admin")}
    await s.db.users.insert_one(worker)
    worker_auth = {"Authorization": "Bearer " + s.make_token(worker)}
    assert (await http.get("/api/admin/account-deletion", headers=worker_auth)).status_code == 403
    assert (await http.get(f"/api/admin/account-deletion/{pending.json()['reference']}/review",
                           headers=worker_auth)).status_code == 403


async def test_manager_cleanup_verifies_private_object_removal_before_finishing(http, actors, monkeypatch):
    user, auth = await customer()
    path = f"bring-gift-card/uploads/{user['id']}/{uuid.uuid4().hex}.jpg"
    await s.db.uploads.insert_one({"path": path, "user_id": user["id"], "created_at": s.now()})
    pending = (await http.post("/api/account-deletion", headers=auth,
        json={"confirmation": "DELETE", "password": "DeleteCustomer!42"})).json()
    request_id = pending["reference"]
    review = await http.get(f"/api/admin/account-deletion/{request_id}/review", headers=actors[3])
    assert review.status_code == 200
    assert any(upload["path"] == path for upload in review.json()["uploads"])
    monkeypatch.delenv("S3_BUCKET", raising=False)
    unavailable = await http.post(f"/api/admin/account-deletion/{request_id}/cleanup", headers=actors[3],
        json={"confirmation": "REVIEWED", "upload_paths": [path]})
    assert unavailable.status_code == 503
    assert await s.db.uploads.find_one({"path": path})
    monkeypatch.setenv("S3_BUCKET", "disposable-test-bucket")
    def failed_delete(_):
        raise RuntimeError("Object still exists")
    monkeypatch.setattr(s, "delete_private", failed_delete)
    failed = await http.post(f"/api/admin/account-deletion/{request_id}/cleanup", headers=actors[3],
        json={"confirmation": "REVIEWED", "upload_paths": [path]})
    assert failed.status_code == 502
    assert await s.db.uploads.find_one({"path": path})
    deleted = []
    monkeypatch.setattr(s, "delete_private", lambda object_path: deleted.append(object_path))
    completed = await http.post(f"/api/admin/account-deletion/{request_id}/cleanup", headers=actors[3],
        json={"confirmation": "REVIEWED", "upload_paths": [path]})
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "completed"
    assert completed.json()["removed_uploads"] == 1 and deleted == [path]
    assert not await s.db.uploads.find_one({"path": path})
    assert (await http.get("/api/auth/me", headers=auth)).status_code == 401


async def test_nonfinancial_support_requires_review_and_kyc_retention_is_documented(http, actors, monkeypatch):
    user, auth = await customer()
    ticket_id = uuid.uuid4().hex
    kyc_id = uuid.uuid4().hex
    path = f"bring-gift-card/uploads/{user['id']}/{uuid.uuid4().hex}.jpg"
    identity_path = f"bring-gift-card/uploads/{user['id']}/{uuid.uuid4().hex}.jpg"
    await s.db.uploads.insert_one({"path": path, "user_id": user["id"], "created_at": s.now()})
    await s.db.uploads.insert_one({"path": identity_path, "user_id": user["id"], "created_at": s.now()})
    await s.db.support_tickets.insert_one({"id": ticket_id, "user_id": user["id"],
        "category": "other", "status": "CLOSED", "subject": "General question"})
    await s.db.support_messages.insert_one({"id": uuid.uuid4().hex, "ticket_id": ticket_id,
        "sender": "customer", "sender_name": user["full_name"], "body": "Unrelated personal details",
        "image_paths": [path]})
    await s.db.kyc_submissions.insert_one({"id": kyc_id, "user_id": user["id"],
                                           "status": "VERIFIED", "id_front_path": identity_path,
                                           "created_at": s.now()})
    pending = (await http.post("/api/account-deletion", headers=auth,
        json={"confirmation": "DELETE", "password": "DeleteCustomer!42"})).json()
    assert pending["status"] == "pending_review" and "identity" in pending["reason"].lower()
    request_id = pending["reference"]
    review = (await http.get(f"/api/admin/account-deletion/{request_id}/review", headers=actors[3])).json()
    assert review["kyc_submissions"][0]["id"] == kyc_id
    assert any(row["path"] == identity_path and row["kyc_evidence"] for row in review["uploads"])
    assert review["support_tickets"][0]["can_remove"]
    assert (await http.post(f"/api/admin/account-deletion/{request_id}/kyc-review", headers=actors[3],
        json={"decision": "retain", "records_reviewed": False,
              "reason": "Retain verified identity record for documented fraud review."})).status_code == 422
    documented = await http.post(f"/api/admin/account-deletion/{request_id}/kyc-review", headers=actors[3],
        json={"decision": "retain", "records_reviewed": True,
              "reason": "Retain verified identity record for documented fraud review."})
    assert documented.status_code == 200, documented.text
    row = await s.db.account_deletion_requests.find_one({"id": request_id})
    assert row["kyc_retention_reviewed_by"] == actors[1]["id"]
    assert row["kyc_retention_reason"].startswith("Retain verified")
    monkeypatch.setenv("S3_BUCKET", "disposable-test-bucket")
    deleted = []
    monkeypatch.setattr(s, "delete_private", lambda object_path: deleted.append(object_path))
    cleanup = await http.post(f"/api/admin/account-deletion/{request_id}/cleanup", headers=actors[3],
        json={"confirmation": "REVIEWED", "ticket_ids": [ticket_id]})
    assert cleanup.status_code == 200, cleanup.text
    assert cleanup.json()["status"] == "completed"
    assert not await s.db.support_tickets.find_one({"id": ticket_id})
    assert not await s.db.support_messages.find_one({"ticket_id": ticket_id})
    assert deleted == [path] and not await s.db.uploads.find_one({"path": path})
    assert await s.db.kyc_submissions.find_one({"id": kyc_id})
    assert await s.db.uploads.find_one({"path": identity_path})


async def test_open_financial_support_ticket_blocks_account_closure(http, actors):
    user, auth = await customer()
    ticket_id = uuid.uuid4().hex
    await s.db.support_tickets.insert_one({"id": ticket_id, "user_id": user["id"],
        "category": "trade", "ref_type": "trade", "ref_id": uuid.uuid4().hex,
        "status": "OPEN", "subject": "Payment dispute"})
    pending = (await http.post("/api/account-deletion", headers=auth,
        json={"confirmation": "DELETE", "password": "DeleteCustomer!42"})).json()
    assert pending["status"] == "pending_review" and "support" in pending["reason"].lower()
    await s.db.support_tickets.update_one({"id": ticket_id}, {"$set": {"status": "CLOSED"}})
    completed = await http.post(f"/api/admin/account-deletion/{pending['reference']}/finalize", headers=actors[3])
    assert completed.status_code == 200 and completed.json()["status"] == "completed"


async def test_manager_deletion_queue_can_page_through_requests(http, actors):
    for _ in range(2):
        user, auth = await customer()
        await s.db.trades.insert_one({"id": uuid.uuid4().hex, "user_id": user["id"],
            "status": "PENDING_REVIEW", "currency": "NGN", "expected_payout_kobo": 1000})
        response = await http.post("/api/account-deletion", headers=auth,
            json={"confirmation": "DELETE", "password": "DeleteCustomer!42"})
        assert response.status_code == 200 and response.json()["status"] == "pending_review"
    first = await http.get("/api/admin/account-deletion?status=pending_review&page=1&page_size=1",
                           headers=actors[3])
    second = await http.get("/api/admin/account-deletion?status=pending_review&page=2&page_size=1",
                            headers=actors[3])
    assert first.status_code == second.status_code == 200
    assert first.json()["total"] >= 2 and first.json()["page_size"] == 1
    assert first.json()["total"] == second.json()["total"]
    assert first.json()["requests"][0]["reference"] != second.json()["requests"][0]["reference"]


async def test_private_storage_delete_requires_verified_absence(monkeypatch):
    calls = []
    class MissingAfterDelete:
        def delete_object(self, **kwargs):
            calls.append(("delete", kwargs))
        def head_object(self, **kwargs):
            calls.append(("head", kwargs))
            raise ClientError({"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject")
    monkeypatch.setenv("S3_BUCKET", "disposable-test-bucket")
    monkeypatch.setattr(private_services, "s3_client", lambda: MissingAfterDelete())
    private_services.delete_private("bring-gift-card/uploads/customer/photo.jpg")
    assert [call[0] for call in calls] == ["delete", "head"]
    class StillPresent(MissingAfterDelete):
        def head_object(self, **kwargs):
            return {"ContentLength": 1}
    monkeypatch.setattr(private_services, "s3_client", lambda: StillPresent())
    with pytest.raises(RuntimeError, match="still exists"):
        private_services.delete_private("bring-gift-card/uploads/customer/photo.jpg")


async def test_inflight_support_write_cannot_restore_content_after_deletion(http, monkeypatch):
    user, auth = await customer()
    deletion_locked = asyncio.Event()
    support_waiting = asyncio.Event()
    release_deletion = asyncio.Event()
    original_blocker = s._account_deletion_blocker
    original_lock = s.money.lock_user

    async def paused_blocker(user_id, session):
        deletion_locked.set()
        await release_deletion.wait()
        return await original_blocker(user_id, session)

    async def observed_lock(user_id, session):
        if deletion_locked.is_set() and user_id == user["id"]:
            support_waiting.set()
        return await original_lock(user_id, session)

    monkeypatch.setattr(s, "_account_deletion_blocker", paused_blocker)
    monkeypatch.setattr(s.money, "lock_user", observed_lock)
    deletion = asyncio.create_task(http.post("/api/account-deletion", headers=auth,
        json={"confirmation": "DELETE", "password": "DeleteCustomer!42"}), name="deletion_attempt")
    try:
        await asyncio.wait_for(deletion_locked.wait(), timeout=10)
        support = asyncio.create_task(http.post("/api/support/tickets", headers=auth,
            json={"subject": "Account question", "message": "Private customer details"}), name="support_attempt")
        await asyncio.wait_for(support_waiting.wait(), timeout=10)
    finally:
        release_deletion.set()
    assert (await deletion).json()["status"] == "completed"
    assert (await support).status_code == 401
    assert await s.db.support_tickets.count_documents({"user_id": user["id"]}) == 0

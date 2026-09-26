"""Atomic ledger operations on a MongoDB replica set.

The user revision write serializes concurrent wallet mutations. All financial
records and notifications commit together; no balance cache becomes authority.
Legacy *_kobo field names are retained and mean integer currency minor units.
"""
from fastapi import HTTPException


class Money:
    def __init__(self, server):
        self.s = server
        self.db = server.db

    async def transaction(self, callback):
        async with await self.s.client.start_session() as session:
            return await session.with_transaction(callback)

    async def lock_user(self, user_id, session):
        result = await self.db.users.update_one({"id": user_id}, {"$inc": {"money_revision": 1}}, session=session)
        if not result.matched_count:
            raise HTTPException(404, "Customer not found")

    async def ledger(self, user_id, kind, amount, ref_type, ref_id, currency, session):
        await self.db.ledger.insert_one({"id": self.s.new_id(), "dedup_key": f"{kind}:{ref_type}:{ref_id}",
            "user_id": user_id, "type": kind, "amount_kobo": amount, "currency": currency,
            "ref_type": ref_type, "ref_id": ref_id, "description": kind.replace("_", " ").title(),
            "created_at": self.s.now()}, session=session)

    async def event(self, uid, title, kind, ref, actor, session):
        await self.db.notifications.insert_one({"id": self.s.new_id(), "user_id": uid,
            "title": title, "body": title, "type": kind, "ref_id": ref,
            "read": False, "created_at": self.s.now()}, session=session)
        await self.db.audit.insert_one({"actor": actor, "action": title, "target": ref,
            "at": self.s.now()}, session=session)

    async def withdraw(self, x, user, request_key):
        await self.s.verify_pin_or_raise(user, x.pin)
        currency = user.get("currency", "NGN")
        wid = self.s.new_id()
        async def run(session):
            await self.lock_user(user["id"], session)
            previous = await self.db.withdrawals.find_one({"user_id": user["id"], "request_key": request_key}, {"_id": 0}, session=session)
            if previous:
                if previous["amount_kobo"] != x.amount_kobo or previous["payout_account_id"] != x.payout_account_id:
                    raise HTTPException(409, "Request key was already used for different withdrawal details")
                return previous
            acc = await self.db.payout_accounts.find_one({"id": x.payout_account_id, "user_id": user["id"], "deleted_at": None}, {"_id": 0}, session=session)
            if not acc or acc.get("currency", "NGN") != currency:
                raise HTTPException(400, "Select a valid payout account in your wallet currency")
            rows = await self.db.ledger.aggregate([
                {"$match": {"user_id": user["id"]}}, {"$group": {"_id": None, "total": {"$sum": "$amount_kobo"}}}
            ], session=session).to_list(1)
            balance = int(rows[0]["total"]) if rows else 0
            if x.amount_kobo > balance:
                raise HTTPException(400, "Amount exceeds your available balance")
            w = {"id": wid, "ref": self.s.order_ref("BGCW"), "user_id": user["id"],
                "amount_kobo": x.amount_kobo, "currency": currency, "minor_digits": user.get("minor_digits", 2), "request_key": request_key,
                "payout_account_id": acc["id"], "destination": acc, "narration": x.narration,
                "status": "PENDING", "reason": "", "created_at": self.s.now(), "updated_at": self.s.now(),
                "status_history": [{"status": "PENDING", "at": self.s.now(), "by": user["id"], "note": "Funds reserved"}]}
            await self.db.withdrawals.insert_one(dict(w), session=session)
            await self.ledger(user["id"], "WITHDRAWAL_DEBIT", -x.amount_kobo, "withdrawal", wid, currency, session)
            await self.event(user["id"], "Withdrawal requested", "withdrawal", wid, user["id"], session)
            return w
        return await self.transaction(run)

    async def review(self, trade_id, status, admin, amount=None, note=""):
        async def run(session):
            t = await self.db.trades.find_one({"id": trade_id}, session=session)
            if not t:
                raise HTTPException(404, "Trade not found")
            await self.lock_user(t["user_id"], session)
            if t["status"] == status and status in ("APPROVED", "REJECTED"):
                return {"ok": True, "credited": False}
            if t["status"] not in ("PENDING_REVIEW", "NEED_MORE_INFO"):
                raise HTTPException(409, "Trade is already finalized")
            changes = {"status": status, "updated_at": self.s.now(), "reason": note}
            if status == "APPROVED":
                final = amount if amount is not None else t["expected_payout_kobo"]
                if final <= 0:
                    raise HTTPException(422, "Approved amount must be positive")
                await self.ledger(t["user_id"], "TRADE_CREDIT", final, "trade", trade_id, t.get("currency", "NGN"), session)
                changes.update(approved_payout_kobo=final, credited=True, admin_note=note)
            await self.db.trades.update_one({"id": trade_id}, {"$set": changes,
                "$push": {"status_history": {"status": status, "at": self.s.now(), "by": admin["id"], "note": note}}}, session=session)
            await self.event(t["user_id"], "Trade " + status.lower().replace("_", " "), "trade", trade_id, admin["id"], session)
            return {"ok": True, "credited": status == "APPROVED"}
        return await self.transaction(run)

    async def settle(self, wid, status, actor, note, provider=False, external_reference=""):
        async def run(session):
            w = await self.db.withdrawals.find_one({"id": wid}, session=session)
            if not w:
                raise HTTPException(404, "Withdrawal not found")
            await self.lock_user(w["user_id"], session)
            if w["status"] == status:
                return {"ok": True}
            if w.get("provider_id") and w["provider_id"] != "manual" and not provider:
                raise HTTPException(409, "Provider payout must be reconciled with its provider")
            allowed = w["status"] in ("PENDING", "PROCESSING") or (provider and status == "REVERSED" and w["status"] == "PAID")
            if not allowed:
                raise HTTPException(409, "Withdrawal is already finalized")
            if status in ("REJECTED", "REVERSED"):
                await self.ledger(w["user_id"], "WITHDRAWAL_REVERSAL", w["amount_kobo"], "withdrawal", wid, w.get("currency", "NGN"), session)
            await self.db.withdrawals.update_one({"id": wid}, {"$set": {"status": status,
                "reason": note, "updated_at": self.s.now(),
                **({"payment_reference": external_reference} if external_reference else {})}, "$push": {"status_history": {
                    "status": status, "at": self.s.now(), "by": actor, "note": note}}}, session=session)
            await self.event(w["user_id"], "Withdrawal " + status.lower(), "withdrawal", wid, actor, session)
            return {"ok": True}
        return await self.transaction(run)

"""Admin-owned markets, denomination rates, provider configuration and payouts."""
import json
import os
from decimal import Decimal
from typing import Literal
from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from pymongo import ReturnDocument
from payout_providers import ADAPTERS, ProviderError


def cipher():
    key = os.environ.get("DATA_ENCRYPTION_KEY", "")
    if not key:
        raise HTTPException(503, "Server encryption key is not configured")
    return Fernet(key.encode())


def encrypt(value):
    return cipher().encrypt(value.encode()).decode() if value else ""


def decrypt(value):
    return cipher().decrypt(value.encode()).decode() if value else ""


class MarketIn(BaseModel):
    code: str = Field(pattern=r"^[A-Z]{2}$")
    name: str = Field(min_length=2, max_length=80)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    minor_digits: int = Field(default=2, ge=0, le=3)
    is_active: bool = True


class RateIn(BaseModel):
    brand_id: str
    market_code: str
    face_value: int = Field(gt=0, le=1000000)
    payout_minor: int = Field(gt=0, le=9000000000000)
    is_active: bool = True


class QuoteIn(BaseModel):
    brand_id: str
    face_value: int = Field(gt=0)
    quantity: int = Field(default=1, ge=1, le=100)


class ProviderIn(BaseModel):
    label: str = Field(min_length=2, max_length=100)
    adapter: str = Field(pattern=r"^[a-z][a-z0-9_-]{1,40}$")
    enabled: bool = False
    secret: str = Field(default="", max_length=2000)
    webhook_secret: str = Field(default="", max_length=2000)


class DispatchIn(BaseModel):
    provider_id: str = ""


class ManualPaidIn(BaseModel):
    external_reference: str = Field(min_length=3, max_length=150)


class LegalIn(BaseModel):
    title: str = Field(min_length=3, max_length=150)
    content: str = Field(min_length=40, max_length=100000)


class Production:
    def __init__(self, s):
        self.s, self.db = s, s.db

    async def audit(self, actor, action, target):
        await self.db.audit.insert_one({"actor": actor, "action": action, "target": target, "at": self.s.now()})

    async def quote(self, brand_id, face_value, quantity, user):
        market = await self.db.markets.find_one({"code": user.get("market_code", "NG"), "is_active": True})
        brand = await self.db.brands.find_one({"id": brand_id, "is_active": True})
        if not market or not brand:
            raise HTTPException(400, "Card or market is not available")
        if market["currency"] != user.get("currency", "NGN"):
            raise HTTPException(409, "Market currency does not match this wallet")
        rate = await self.db.card_rates.find_one({"brand_id": brand_id, "market_code": market["code"],
            "face_value": face_value, "is_active": True}, {"_id": 0})
        if not rate:
            raise HTTPException(409, "No active rate for this card value and payout market")
        return {"rate_id": rate["id"], "rate_version": rate["version"], "currency": market["currency"],
            "minor_digits": market["minor_digits"], "market_code": market["code"],
            "unit_payout_minor": rate["payout_minor"], "payout_minor": rate["payout_minor"] * quantity}

    async def provider(self, provider_id, enabled=False):
        p = await self.db.payout_providers.find_one({"id": provider_id})
        if not p or (enabled and not p.get("enabled")) or p["adapter"] not in ADAPTERS:
            raise HTTPException(409, "Provider is disabled, unconfigured, or awaiting an adapter")
        return p, ADAPTERS[p["adapter"]](decrypt(p.get("secret", "")), decrypt(p.get("webhook_secret", "")))

    async def reconcile(self, wid):
        w = await self.db.withdrawals.find_one({"id": wid}, {"_id": 0})
        if not w or not w.get("provider_reference"):
            raise HTTPException(409, "No provider payout to reconcile")
        _, adapter = await self.provider(w["provider_id"])
        try:
            data = await adapter.verify(w)
        except ProviderError as exc:
            raise HTTPException(502, str(exc))
        if not adapter.matches(data, w):
            raise HTTPException(409, "Provider reference, amount, currency or destination mismatch; funds remain reserved")
        state = adapter.state(data)
        if state != "PROCESSING":
            await self.s.money.settle(wid, state, "provider:" + w["provider_id"], "Verified provider result", provider=True)
        await self.db.withdrawals.update_one({"id": wid}, {"$set": {"last_reconciled_at": self.s.now(), "provider_status": str(data.get("status", ""))}})
        return {"status": state}

    def router(self):
        api = APIRouter(prefix="/api")
        s, db = self.s, self.db

        @api.get("/markets")
        async def markets():
            return {"markets": await db.markets.find({"is_active": True}, {"_id": 0}).sort("name", 1).to_list(250)}

        @api.get("/admin/markets")
        async def admin_markets(admin=Depends(s.require_admin)):
            return {"markets": await db.markets.find({}, {"_id": 0}).sort("name", 1).to_list(250)}

        @api.post("/admin/markets")
        async def save_market(x: MarketIn, admin=Depends(s.require_admin)):
            old = await db.markets.find_one({"code": x.code})
            if old and (old["currency"] != x.currency or old["minor_digits"] != x.minor_digits):
                raise HTTPException(409, "Currency and precision are immutable; create a separate market instead")
            # ISO currency precision must also agree across markets.
            same = await db.markets.find_one({"currency": x.currency, "minor_digits": {"$ne": x.minor_digits}})
            if same:
                raise HTTPException(409, "Currency precision conflicts with an existing market")
            await db.markets.update_one({"code": x.code}, {"$set": x.model_dump()}, upsert=True)
            await self.audit(admin["id"], "market.updated", x.code)
            return x

        @api.get("/card-rates")
        async def rates(brand_id: str = "", market_code: str = "NG"):
            q = {"market_code": market_code, "is_active": True}
            if brand_id:
                q["brand_id"] = brand_id
            market = await db.markets.find_one({"code": market_code, "is_active": True}, {"_id": 0})
            if not market:
                return {"rates": [], "market": None}
            brands = await db.brands.distinct("id", {"is_active": True})
            q["brand_id"] = brand_id if brand_id in brands else {"$in": brands} if not brand_id else ""
            return {"rates": await db.card_rates.find(q, {"_id": 0}).sort("face_value", 1).to_list(5000), "market": market}

        @api.get("/admin/card-rates")
        async def admin_rates(brand_id: str, admin=Depends(s.require_admin)):
            return {"rates": await db.card_rates.find({"brand_id": brand_id}, {"_id": 0}).to_list(5000)}

        @api.post("/admin/card-rates")
        async def save_rate(x: RateIn, admin=Depends(s.require_admin)):
            if not await db.brands.find_one({"id": x.brand_id}) or not await db.markets.find_one({"code": x.market_code}):
                raise HTTPException(400, "Select an existing card and market")
            key = {"brand_id": x.brand_id, "market_code": x.market_code, "face_value": x.face_value}
            async def run(session):
                row = await db.card_rates.find_one_and_update(key, {"$set": {**x.model_dump(), "updated_at": s.now()},
                    "$setOnInsert": {"id": s.new_id()}, "$inc": {"version": 1}}, upsert=True,
                    return_document=ReturnDocument.AFTER, session=session)
                await db.audit.insert_one({"actor": admin["id"], "action": "rate.updated", "target": row["id"],
                    "rate": x.model_dump(), "version": row["version"], "at": s.now()}, session=session)
                row.pop("_id", None)
                return row
            return await s.money.transaction(run)

        @api.delete("/admin/card-rates/{rate_id}")
        async def delete_rate(rate_id: str, admin=Depends(s.require_admin)):
            async def run(session):
                row = await db.card_rates.find_one_and_update({"id": rate_id}, {"$set": {"is_active": False}, "$inc": {"version": 1}}, return_document=ReturnDocument.AFTER, session=session)
                if not row:
                    raise HTTPException(404, "Rate not found")
                row.pop("_id", None)
                await db.audit.insert_one({"actor": admin["id"], "action": "rate.disabled", "target": rate_id, "rate": row, "version": row["version"], "at": s.now()}, session=session)
            await s.money.transaction(run)
            return {"ok": True}

        @api.get("/admin/denomination-history")
        async def denomination_history(admin=Depends(s.require_admin)):
            rows = await db.audit.find({"action": {"$in": ["rate.updated", "rate.disabled"]}}, {"_id": 0}).sort("at", -1).to_list(300)
            names = {b["id"]: b["name"] for b in await db.brands.find({}, {"id": 1, "name": 1}).to_list(1000)}
            markets = {m["code"]: m for m in await db.markets.find({}, {"_id": 0}).to_list(250)}
            for row in rows:
                rate = row.get("rate", {})
                row["brand_name"] = names.get(rate.get("brand_id"), "Gift card")
                row["market"] = markets.get(rate.get("market_code"))
            return {"changes": rows}

        @api.post("/quotes")
        async def quote(x: QuoteIn, user=Depends(s.current_user)):
            return await self.quote(x.brand_id, x.face_value, x.quantity, user)

        @api.get("/admin/payout-providers")
        async def providers(admin=Depends(s.require_admin)):
            rows = await db.payout_providers.find({}, {"_id": 0}).to_list(100)
            for p in rows:
                p["configured"] = bool(p.pop("secret", ""))
                p["webhook_configured"] = bool(p.pop("webhook_secret", ""))
                p["available"] = p["adapter"] in ADAPTERS
            setting = await db.settings.find_one({"id": "payout"}) or {}
            return {"providers": [{"id": "manual", "label": "Manual / Company Payout", "adapter": "manual", "enabled": True, "available": True}, *rows],
                "default": setting.get("default", "manual"), "adapters": list(ADAPTERS)}

        @api.post("/admin/payout-providers/{provider_id}")
        async def save_provider(provider_id: str, x: ProviderIn, admin=Depends(s.require_admin)):
            if provider_id == "manual" or not provider_id.isalnum() or len(provider_id) > 40:
                raise HTTPException(422, "Use a short alphanumeric provider ID other than manual")
            old = await db.payout_providers.find_one({"id": provider_id}) or {}
            if old and old["adapter"] != x.adapter:
                raise HTTPException(409, "An existing provider adapter cannot be changed")
            if x.enabled and x.adapter not in ADAPTERS:
                raise HTTPException(409, "A reviewed adapter must be installed before enabling this provider")
            if x.enabled and not (x.secret or old.get("secret")):
                raise HTTPException(422, "A secret key is required")
            if x.enabled and x.adapter == "flutterwave" and not (x.webhook_secret or old.get("webhook_secret")):
                raise HTTPException(422, "Flutterwave webhook secret is required")
            if (x.secret or x.webhook_secret) and await db.withdrawals.find_one({"provider_id": provider_id, "status": "PROCESSING"}):
                raise HTTPException(409, "Reconcile pending payouts before rotating this provider's keys")
            changes = x.model_dump(exclude={"secret", "webhook_secret"})
            if x.secret:
                changes["secret"] = encrypt(x.secret)
            if x.webhook_secret:
                changes["webhook_secret"] = encrypt(x.webhook_secret)
            await db.payout_providers.update_one({"id": provider_id}, {"$set": changes}, upsert=True)
            await self.audit(admin["id"], "provider.updated", provider_id)
            return {"ok": True}

        @api.post("/admin/payout-default")
        async def default(x: DispatchIn, admin=Depends(s.require_admin)):
            if x.provider_id != "manual":
                await self.provider(x.provider_id, enabled=True)
            await db.settings.update_one({"id": "payout"}, {"$set": {"default": x.provider_id}}, upsert=True)
            await self.audit(admin["id"], "provider.default", x.provider_id)
            return {"ok": True}

        @api.get("/payout-options")
        async def options(user=Depends(s.current_user)):
            rows = await db.payout_providers.find({"enabled": True}, {"_id": 0, "id": 1, "label": 1, "adapter": 1}).to_list(100)
            return {"providers": [p for p in rows if p["adapter"] in ADAPTERS and user.get("currency", "NGN") in ADAPTERS[p["adapter"]].currencies]}

        @api.get("/payout-banks/{provider_id}")
        async def banks(provider_id: str, user=Depends(s.current_user)):
            _, adapter = await self.provider(provider_id, enabled=True)
            if user.get("currency", "NGN") not in adapter.currencies:
                raise HTTPException(400, "This provider does not support your wallet currency")
            try:
                return {"banks": await adapter.banks()}
            except ProviderError as exc:
                raise HTTPException(502, str(exc))

        @api.post("/admin/withdrawals/{wid}/dispatch")
        async def dispatch(wid: str, x: DispatchIn, admin=Depends(s.require_admin)):
            setting = await db.settings.find_one({"id": "payout"}) or {}
            pid = x.provider_id or setting.get("default", "manual")
            w = await db.withdrawals.find_one({"id": wid}, {"_id": 0})
            if not w:
                raise HTTPException(404, "Withdrawal not found")
            if w["status"] != "PENDING" or w.get("provider_id"):
                raise HTTPException(409, "Payout already started; use Reconcile, never send it again")
            if pid == "manual":
                claimed = await db.withdrawals.update_one({"id": wid, "status": "PENDING", "provider_id": {"$exists": False}},
                    {"$set": {"provider_id": "manual", "status": "PROCESSING", "updated_at": s.now()},
                     "$push": {"status_history": {"status": "PROCESSING", "at": s.now(), "by": admin["id"], "note": "Company payout started"}}})
                if not claimed.modified_count:
                    raise HTTPException(409, "Payout already started")
                await self.audit(admin["id"], "payout.manual.started", wid)
                return {"status": "PROCESSING"}
            _, adapter = await self.provider(pid, enabled=True)
            if w.get("currency", "NGN") not in adapter.currencies or not w["destination"].get("verified") or w["destination"].get("payout_provider_id") != pid:
                raise HTTPException(409, "Destination must be verified with this provider in a supported currency")
            ref = "bgc-" + wid
            claimed = await db.withdrawals.update_one({"id": wid, "status": "PENDING", "provider_id": {"$exists": False}},
                {"$set": {"provider_id": pid, "provider_reference": ref, "currency": w.get("currency", "NGN"),
                    "status": "PROCESSING", "updated_at": s.now()},
                 "$push": {"status_history": {"status": "PROCESSING", "at": s.now(), "by": admin["id"], "note": "Provider payout submitted"}}})
            if not claimed.modified_count:
                raise HTTPException(409, "Payout already started")
            w.update(provider_reference=ref, currency=w.get("currency", "NGN"))
            try:
                data = await adapter.send(w)
                await db.withdrawals.update_one({"id": wid}, {"$set": {"provider_transfer_id": str(data.get("id", "")), "provider_status": str(data.get("status", "pending"))}})
            except ProviderError:
                await db.withdrawals.update_one({"id": wid}, {"$set": {"provider_status": "UNKNOWN"}})
                return {"status": "PROCESSING", "message": "Result uncertain. Funds remain reserved. Reconcile before taking further action."}
            await self.audit(admin["id"], "payout.dispatched", wid)
            return {"status": "PROCESSING", "message": "Submitted to provider. Await verified settlement."}

        @api.post("/admin/withdrawals/{wid}/reconcile")
        async def reconcile(wid: str, admin=Depends(s.require_admin)):
            return await self.reconcile(wid)

        @api.post("/webhooks/payouts/{provider_id}")
        async def webhook(provider_id: str, request: Request):
            raw = await request.body()
            if len(raw) > 100000:
                raise HTTPException(413, "Payload too large")
            _, adapter = await self.provider(provider_id)
            if not adapter.signature_valid(raw, request.headers):
                raise HTTPException(401, "Invalid signature")
            try:
                payload = json.loads(raw)
                reference = payload.get("data", {}).get("reference")
            except (ValueError, AttributeError):
                raise HTTPException(400, "Invalid event")
            if reference:
                w = await db.withdrawals.find_one({"provider_id": provider_id, "provider_reference": reference})
                if w:
                    await self.reconcile(w["id"])
            return {"ok": True}

        @api.get("/legal/{kind}")
        async def legal(kind: Literal["terms", "privacy"]):
            doc = await db.legal.find_one({"id": kind}, {"_id": 0})
            if not doc:
                raise HTTPException(503, "Company-approved document has not been published yet")
            return doc

        @api.post("/admin/legal/{kind}")
        async def save_legal(kind: Literal["terms", "privacy"], x: LegalIn, admin=Depends(s.require_admin)):
            await db.legal.update_one({"id": kind}, {"$set": {**x.model_dump(), "updated_at": s.now()}, "$inc": {"version": 1}}, upsert=True)
            await self.audit(admin["id"], "legal.published", kind)
            return {"ok": True}

        @api.get("/admin/readiness")
        async def readiness(admin=Depends(s.require_admin)):
            checks = {"markets": await db.markets.count_documents({"is_active": True}) > 0,
                "catalog": await db.brands.count_documents({"is_active": True}) > 0,
                "rates": await db.card_rates.count_documents({"is_active": True}) > 0,
                "legal": await db.legal.count_documents({"id": {"$in": ["terms", "privacy"]}}) == 2,
                "email": bool(os.environ.get("SMTP_HOST") and os.environ.get("SMTP_FROM")),
                "private_storage": bool(os.environ.get("S3_BUCKET") or s.STORAGE_URL),
                "encryption": bool(os.environ.get("DATA_ENCRYPTION_KEY"))}
            return {"checks": checks, "configuration_complete": all(checks.values()),
                "release_note": "Configuration checks do not replace real provider and device acceptance testing."}

        @api.get("/health/ready")
        async def ready():
            try:
                await db.command("ping")
            except Exception:
                raise HTTPException(503, "Database unavailable")
            return {"status": "ready"}

        return api

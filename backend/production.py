"""Admin-owned markets, denomination rates, provider configuration and payouts."""
import json
import os
from decimal import Decimal
from typing import Literal
from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from persistence import ReturnDocument
from payout_providers import ADAPTERS, ProviderError
from legal_documents import default_legal


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
    card_country: str = Field(default="", max_length=24)
    face_value: int = Field(gt=0, le=1000000)
    submission_type: Literal["any", "physical", "ecode"] = "any"
    range_min: int | None = Field(default=None, ge=0, le=1000000)
    range_max: int | None = Field(default=None, ge=0, le=1000000)
    rate_minor_per_usd: int | None = Field(default=None, gt=0, le=9000000000000)
    payout_minor: int | None = Field(default=None, gt=0, le=9000000000000)
    is_active: bool = True
    is_headline: bool = False

    @model_validator(mode="after")
    def validate_rule(self):
        self.card_country = self.card_country.strip().upper()
        if (self.range_min is None) != (self.range_max is None):
            raise ValueError("Range minimum and maximum must be supplied together")
        if self.range_min is not None and self.range_max is not None and self.range_min > self.range_max:
            raise ValueError("Range minimum cannot exceed range maximum")
        if self.is_headline and not self.is_active:
            raise ValueError("The All Cards display rate must be active")
        if self.rate_minor_per_usd is None and self.payout_minor is None:
            raise ValueError("Provide a rate per $1 or a total payout")
        if self.rate_minor_per_usd is not None:
            computed = self.rate_minor_per_usd * self.face_value
            if computed > 9000000000000:
                raise ValueError("Computed payout is too large")
            if self.payout_minor is not None and self.payout_minor != computed:
                raise ValueError("Total payout must equal card value multiplied by the rate per $1")
            self.payout_minor = computed
        elif self.payout_minor is not None and self.payout_minor % self.face_value == 0:
            self.rate_minor_per_usd = self.payout_minor // self.face_value
        return self


class QuoteIn(BaseModel):
    brand_id: str
    face_value: int = Field(gt=0)
    quantity: int = Field(default=1, ge=1, le=100)
    card_country: str = Field(default="", max_length=24)
    submission_type: Literal["any", "physical", "ecode"] = "any"


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


def select_rate_rule(rows: list[dict], card_country: str, submission_type: str, total_face_value: int) -> dict | None:
    """Pick the most specific active rule for a trade without inventing a rate.

    Range conditions apply to the trade's total face value (face value × quantity).
    Exact card-country/type rules outrank general/legacy fallbacks; a matching ranged
    rule outranks an otherwise-equal fixed rule. Equally specific overlapping rules
    are rejected as ambiguous by the caller.
    """
    wanted_country = (card_country or "").strip().upper()
    wanted_type = submission_type or "any"
    matches: list[tuple[int, dict]] = []
    for row in rows:
        row_country = (row.get("card_country") or "").strip().upper()
        row_type = row.get("submission_type") or "any"
        if row_country and row_country != wanted_country:
            continue
        if row_type != "any" and row_type != wanted_type:
            continue
        range_min, range_max = row.get("range_min"), row.get("range_max")
        ranged = range_min is not None and range_max is not None
        if ranged and not (int(range_min) <= total_face_value <= int(range_max)):
            continue
        score = (4 if row_country and row_country == wanted_country else 0) + \
                (2 if row_type != "any" and row_type == wanted_type else 0) + \
                (1 if ranged else 0)
        matches.append((score, row))
    if not matches:
        return None
    best = max(score for score, _ in matches)
    winners = [row for score, row in matches if score == best]
    if len(winners) > 1:
        raise ValueError("Multiple equally specific rate rules match this trade")
    return winners[0]


class Production:
    def __init__(self, s):
        self.s, self.db = s, s.db

    async def audit(self, actor, action, target):
        await self.db.audit.insert_one({"actor": actor, "action": action, "target": target, "at": self.s.now()})

    async def quote(self, brand_id, face_value, quantity, user, card_country="", submission_type="any",
                    session=None, lock_rows=False):
        market = await self.db.markets.find_one({"code": user.get("market_code", "NG"), "is_active": True},
                                                 session=session, for_update=lock_rows)
        brand = await self.db.brands.find_one({"id": brand_id, "is_active": True},
                                               session=session, for_update=lock_rows)
        if not market or not brand or not brand.get("submission_types", ["physical", "ecode"]):
            raise HTTPException(400, "Card or market is not available")
        if market["currency"] != user.get("currency", "NGN"):
            raise HTTPException(409, "Market currency does not match this wallet")
        if submission_type != "any" and submission_type not in brand.get("submission_types", ["physical", "ecode"]):
            raise HTTPException(400, "That submission type is not available for this card")

        rows = await self.db.card_rates.find({
            "brand_id": brand_id,
            "market_code": market["code"],
            "face_value": face_value,
            "is_active": True,
        }, {"_id": 0}, session=session).to_list(500)
        total_face_value = face_value * quantity
        try:
            rate = select_rate_rule(rows, card_country, submission_type, total_face_value)
        except ValueError as exc:
            raise HTTPException(409, str(exc))
        if not rate:
            raise HTTPException(409, "No active rate matches this card country, type, value and trade amount")

        if lock_rows:
            locked = await self.db.card_rates.find_one({"id": rate["id"], "is_active": True},
                                                       {"_id": 0}, session=session, for_update=True)
            if not locked:
                raise HTTPException(409, "Rate changed. Refresh the quote and try again.")
            rate = locked

        per_usd = rate.get("rate_minor_per_usd")
        if per_usd is None and rate["face_value"] and rate["payout_minor"] % rate["face_value"] == 0:
            per_usd = rate["payout_minor"] // rate["face_value"]
        if per_usd is None:
            raise HTTPException(409, "This legacy rate cannot be used for exact trade pricing")
        unit_payout = per_usd * face_value
        return {
            "rate_id": rate["id"], "rate_version": rate["version"], "currency": market["currency"],
            "minor_digits": market["minor_digits"], "market_code": market["code"],
            "unit_payout_minor": unit_payout, "payout_minor": unit_payout * quantity,
            "rate_minor_per_usd": per_usd, "card_country": rate.get("card_country", ""),
            "submission_type": rate.get("submission_type", "any"),
            "range_min": rate.get("range_min"), "range_max": rate.get("range_max"),
        }

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
            available_brands = await db.brands.find({"is_active": True},
                {"id": 1, "submission_types": 1}).to_list(5000)
            brands = [brand["id"] for brand in available_brands
                      if brand.get("submission_types", ["physical", "ecode"])]
            q["brand_id"] = brand_id if brand_id in brands else {"$in": brands} if not brand_id else ""
            rows = await db.card_rates.find(q, {"_id": 0}).sort([
                ("card_country", 1), ("face_value", 1), ("submission_type", 1), ("range_min", 1), ("range_max", 1)
            ]).to_list(5000)
            return {"rates": rows, "market": market}

        @api.get("/admin/card-rates")
        async def admin_rates(brand_id: str, admin=Depends(s.require_admin)):
            rows = await db.card_rates.find({"brand_id": brand_id}, {"_id": 0}).sort([
                ("market_code", 1), ("card_country", 1), ("face_value", 1), ("submission_type", 1),
                ("range_min", 1), ("range_max", 1)
            ]).to_list(5000)
            return {"rates": rows}

        def rate_key(x: RateIn) -> dict:
            return {
                "brand_id": x.brand_id, "market_code": x.market_code, "card_country": x.card_country, "face_value": x.face_value,
                "submission_type": x.submission_type, "range_min": x.range_min, "range_max": x.range_max,
            }

        async def ensure_rate_refs(x: RateIn):
            if not await db.brands.find_one({"id": x.brand_id}) or not await db.markets.find_one({"code": x.market_code}):
                raise HTTPException(400, "Select an existing card and market")

        async def write_rate(x: RateIn, admin: dict, rate_id: str = ""):
            await ensure_rate_refs(x)
            key = rate_key(x)
            payload = x.model_dump()
            async def run(session):
                if x.is_headline:
                    await db.card_rates.update_many(
                        {"brand_id": x.brand_id, "market_code": x.market_code, "is_headline": True},
                        {"$set": {"is_headline": False, "updated_at": s.now()}},
                        session=session,
                    )
                if rate_id:
                    current = await db.card_rates.find_one({"id": rate_id}, session=session, for_update=True)
                    if not current:
                        raise HTTPException(404, "Rate not found")
                    duplicate = await db.card_rates.find_one({**key, "id": {"$ne": rate_id}}, session=session)
                    if duplicate:
                        raise HTTPException(409, "A rate rule already exists for this card, market, value, type and range")
                    row = await db.card_rates.find_one_and_update({"id": rate_id}, {
                        "$set": {**payload, "updated_at": s.now(), "archived_at": None},
                        "$inc": {"version": 1},
                    }, return_document=ReturnDocument.AFTER, session=session)
                else:
                    row = await db.card_rates.find_one_and_update(key, {
                        "$set": {**payload, "updated_at": s.now(), "archived_at": None},
                        "$setOnInsert": {"id": s.new_id()}, "$inc": {"version": 1},
                    }, upsert=True, return_document=ReturnDocument.AFTER, session=session)
                await db.audit.insert_one({"actor": admin["id"], "action": "rate.updated", "target": row["id"],
                    "rate": {k: v for k, v in row.items() if k != "_id"}, "version": row["version"], "at": s.now()}, session=session)
                row.pop("_id", None)
                return row
            return await s.money.transaction(run)

        @api.post("/admin/card-rates")
        async def save_rate(x: RateIn, admin=Depends(s.require_admin)):
            return await write_rate(x, admin)

        @api.patch("/admin/card-rates/{rate_id}")
        async def edit_rate(rate_id: str, x: RateIn, admin=Depends(s.require_admin)):
            return await write_rate(x, admin, rate_id)

        async def disable_rate_row(rate_id: str, admin: dict):
            async def run(session):
                row = await db.card_rates.find_one_and_update({"id": rate_id}, {
                    "$set": {"is_active": False, "is_headline": False, "updated_at": s.now()}, "$inc": {"version": 1}
                }, return_document=ReturnDocument.AFTER, session=session)
                if not row:
                    raise HTTPException(404, "Rate not found")
                row.pop("_id", None)
                await db.audit.insert_one({"actor": admin["id"], "action": "rate.disabled", "target": rate_id,
                    "rate": row, "version": row["version"], "at": s.now()}, session=session)
                return row
            return await s.money.transaction(run)

        @api.post("/admin/card-rates/{rate_id}/disable")
        async def disable_rate(rate_id: str, admin=Depends(s.require_admin)):
            row = await disable_rate_row(rate_id, admin)
            return {"ok": True, "rate": row}

        @api.delete("/admin/card-rates/{rate_id}")
        async def delete_rate_legacy(rate_id: str, admin=Depends(s.require_admin)):
            # Backward-compatible endpoint used by the current admin UI: DELETE still
            # means disable. The explicit /safe endpoint below performs safe deletion.
            await disable_rate_row(rate_id, admin)
            return {"ok": True}

        @api.delete("/admin/card-rates/{rate_id}/safe")
        async def safe_delete_rate(rate_id: str, admin=Depends(s.require_admin)):
            async def run(session):
                row = await db.card_rates.find_one({"id": rate_id}, session=session, for_update=True)
                if not row:
                    raise HTTPException(404, "Rate not found")
                used = await db.trades.find_one({"rate_id": rate_id}, {"id": 1}, session=session)
                clean = {k: v for k, v in row.items() if k != "_id"}
                if used:
                    archived = await db.card_rates.find_one_and_update({"id": rate_id}, {
                        "$set": {"is_active": False, "is_headline": False, "archived_at": s.now(), "updated_at": s.now()},
                        "$inc": {"version": 1},
                    }, return_document=ReturnDocument.AFTER, session=session)
                    archived.pop("_id", None)
                    await db.audit.insert_one({"actor": admin["id"], "action": "rate.archived", "target": rate_id,
                        "rate": archived, "version": archived["version"], "at": s.now()}, session=session)
                    return {"ok": True, "deleted": False, "archived": True, "rate": archived}
                result = await db.card_rates.delete_many({"id": rate_id}, session=session)
                if result.deleted_count != 1:
                    raise HTTPException(409, "Rate could not be deleted safely")
                await db.audit.insert_one({"actor": admin["id"], "action": "rate.deleted", "target": rate_id,
                    "rate": clean, "version": clean.get("version", 0), "at": s.now()}, session=session)
                return {"ok": True, "deleted": True, "archived": False}
            return await s.money.transaction(run)

        @api.get("/admin/denomination-history")
        async def denomination_history(admin=Depends(s.require_admin)):
            rows = await db.audit.find({"action": {"$in": ["rate.updated", "rate.disabled", "rate.archived", "rate.deleted"]}}, {"_id": 0}).sort("at", -1).to_list(300)
            names = {b["id"]: b["name"] for b in await db.brands.find({}, {"id": 1, "name": 1}).to_list(1000)}
            markets = {m["code"]: m for m in await db.markets.find({}, {"_id": 0}).to_list(250)}
            for row in rows:
                rate = row.get("rate", {})
                row["brand_name"] = names.get(rate.get("brand_id"), "Gift card")
                row["market"] = markets.get(rate.get("market_code"))
            return {"changes": rows}

        @api.post("/quotes")
        async def quote(x: QuoteIn, user=Depends(s.current_user)):
            return await self.quote(
                x.brand_id, x.face_value, x.quantity, user,
                card_country=x.card_country, submission_type=x.submission_type,
            )

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
        async def dispatch(wid: str, x: DispatchIn, admin=Depends(s.require_staff_scope("withdrawals"))):
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
        async def reconcile(wid: str, admin=Depends(s.require_staff_scope("withdrawals"))):
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
            # Bundled company-approved documents are the production baseline.
            # An admin publication made through this version of the app explicitly
            # marks itself as an override, so legacy placeholder rows cannot silently
            # replace the reviewed legal text.
            doc = await db.legal.find_one({"id": kind, "published_override": True}, {"_id": 0})
            return doc or default_legal(kind)

        @api.post("/admin/legal/{kind}")
        async def save_legal(kind: Literal["terms", "privacy"], x: LegalIn, admin=Depends(s.require_admin)):
            current = await db.legal.find_one({"id": kind}, {"_id": 0, "version": 1})
            version = max(int((current or {}).get("version", 0)) + 1, int(default_legal(kind)["version"]) + 1)
            await db.legal.update_one({"id": kind}, {"$set": {**x.model_dump(), "version": version, "published_override": True, "updated_at": s.now()}}, upsert=True)
            await self.audit(admin["id"], "legal.published", kind)
            return {"ok": True, "version": version}

        @api.get("/admin/readiness")
        async def readiness(admin=Depends(s.require_admin)):
            checks = {"markets": await db.markets.count_documents({"is_active": True}) > 0,
                "catalog": await db.brands.count_documents({"is_active": True}) > 0,
                "rates": await db.card_rates.count_documents({"is_active": True}) > 0,
                "legal": True,  # reviewed default Terms + Privacy are bundled; admin publications may override them
                "email": bool(os.environ.get("SMTP_HOST") and os.environ.get("SMTP_FROM")),
                "private_storage": bool(os.environ.get("S3_BUCKET") or s.STORAGE_URL),
                "encryption": bool(os.environ.get("DATA_ENCRYPTION_KEY"))}
            return {"checks": checks, "configuration_complete": all(checks.values()),
                "release_note": "Configuration checks do not replace real provider and device acceptance testing."}

        @api.get("/health/ready")
        async def ready():
            try:
                await db.ping()
            except Exception:
                raise HTTPException(503, "Database unavailable")
            return {"status": "ready"}

        @api.get("/internal/cleanup-expired", include_in_schema=False)
        async def cleanup_expired(request: Request):
            # PostgreSQL has no Mongo TTL monitor. Expiry is still checked on every
            # token use; this authenticated cron only removes obsolete rows.
            import hmac
            secret = os.environ.get("CRON_SECRET", "")
            if not secret or not hmac.compare_digest(request.headers.get("authorization", ""), "Bearer " + secret):
                raise HTTPException(401, "Not authorized")
            async def run(session):
                resets = await db.password_resets.delete_many({"expires_at": {"$lt": s.now()}}, session=session)
                counters = await db.abuse_counters.delete_many({"expires_at": {"$lt": s.now()}}, session=session)
                uploads = await db.upload_sessions.delete_many({"expires_at": {"$lt": s.now()}}, session=session)
                return {"password_resets": resets.deleted_count, "abuse_counters": counters.deleted_count, "upload_sessions": uploads.deleted_count}
            return await db.transaction(run)

        return api

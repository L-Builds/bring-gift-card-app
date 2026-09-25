"""Provider boundary. No automatic retry of an uncertain money transfer.

Adapters currently support NGN bank transfers. Other markets use company/manual
payouts until their provider-specific destination requirements are implemented.
"""
import hashlib
import hmac
from decimal import Decimal
import httpx


class ProviderError(Exception):
    pass


class BankProvider:
    currencies = {"NGN"}
    base = ""

    def __init__(self, secret, webhook_secret=""):
        self.secret = secret
        self.webhook_secret = webhook_secret

    async def request(self, method, path, **kwargs):
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.request(method, self.base + path,
                    headers={"Authorization": "Bearer " + self.secret}, **kwargs)
                response.raise_for_status()
                payload = response.json()
                if payload.get("status") not in (True, "success"):
                    raise ProviderError("Provider did not confirm the request")
                return payload["data"]
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            raise ProviderError("Provider unavailable; reconcile before any further payout") from exc

    def matches(self, data, withdrawal):
        return (str(data.get("reference")) == withdrawal["provider_reference"]
                and data.get("currency") == withdrawal["currency"]
                and self.amount_minor(data) == withdrawal["amount_kobo"])


class Paystack(BankProvider):
    base = "https://api.paystack.co"

    async def banks(self):
        rows = await self.request("GET", "/bank", params={"country": "nigeria", "perPage": 100})
        return [{"code": b["code"], "name": b["name"]} for b in rows]

    async def resolve(self, bank_code, account_number):
        return await self.request("GET", "/bank/resolve", params={"bank_code": bank_code, "account_number": account_number})

    async def send(self, w):
        a = w["destination"]
        recipient = await self.request("POST", "/transferrecipient", json={
            "type": "nuban", "name": a["account_name"], "account_number": a["account_number"],
            "bank_code": a["bank_code"], "currency": w["currency"]})
        return await self.request("POST", "/transfer", json={"source": "balance", "amount": w["amount_kobo"],
            "recipient": recipient["recipient_code"], "reference": w["provider_reference"],
            "reason": "Bring Gift Card withdrawal " + w["ref"]})

    async def verify(self, w):
        return await self.request("GET", "/transfer/verify/" + w["provider_reference"])

    def signature_valid(self, raw, headers):
        expected = hmac.new(self.secret.encode(), raw, hashlib.sha512).hexdigest()
        return hmac.compare_digest(expected, headers.get("x-paystack-signature", ""))

    def amount_minor(self, data):
        return Decimal(str(data.get("amount", -1)))

    def matches(self, data, w):
        recipient = data.get("recipient") or {}
        details = recipient.get("details") or {}
        return (super().matches(data, w) and details.get("account_number") == w["destination"]["account_number"]
                and str(details.get("bank_code")) == w["destination"]["bank_code"])

    def state(self, data):
        return {"success": "PAID", "failed": "REJECTED", "reversed": "REVERSED"}.get(data.get("status"), "PROCESSING")


class Flutterwave(BankProvider):
    base = "https://api.flutterwave.com/v3"

    async def banks(self):
        rows = await self.request("GET", "/banks/NG")
        return [{"code": b["code"], "name": b["name"]} for b in rows]

    async def resolve(self, bank_code, account_number):
        return await self.request("POST", "/accounts/resolve", json={"account_bank": bank_code, "account_number": account_number})

    async def send(self, w):
        return await self.request("POST", "/transfers", json={
            "account_bank": w["destination"]["bank_code"], "account_number": w["destination"]["account_number"],
            "amount": float(Decimal(w["amount_kobo"]) / 100), "currency": w["currency"],
            "reference": w["provider_reference"], "narration": "Bring Gift Card withdrawal " + w["ref"]})

    async def verify(self, w):
        if w.get("provider_transfer_id"):
            return await self.request("GET", "/transfers/" + str(w["provider_transfer_id"]))
        rows = await self.request("GET", "/transfers", params={"reference": w["provider_reference"]})
        if not isinstance(rows, list):
            raise ProviderError("Transfer is not yet verifiable")
        for row in rows:
            if row.get("reference") == w["provider_reference"]:
                return await self.request("GET", "/transfers/" + str(row["id"]))
        raise ProviderError("Transfer is not yet verifiable; funds remain reserved")

    def signature_valid(self, raw, headers):
        return bool(self.webhook_secret) and hmac.compare_digest(self.webhook_secret, headers.get("verif-hash", ""))

    def amount_minor(self, data):
        return Decimal(str(data.get("amount", -1))) * 100

    def matches(self, data, w):
        return (super().matches(data, w) and data.get("account_number") == w["destination"]["account_number"]
                and str(data.get("bank_code")) == w["destination"]["bank_code"])

    def state(self, data):
        return {"SUCCESSFUL": "PAID", "FAILED": "REJECTED"}.get(str(data.get("status")).upper(), "PROCESSING")


# Register a reviewed adapter here to add another provider. Arbitrary API keys
# alone cannot define another vendor's authentication or transfer protocol.
ADAPTERS = {"paystack": Paystack, "flutterwave": Flutterwave}

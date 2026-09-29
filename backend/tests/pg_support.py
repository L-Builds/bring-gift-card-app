"""Real PostgreSQL transaction tests; provider HTTP is simulated, never real money.

TEST_DATABASE_URL must point to a disposable PostgreSQL test database. Each run
creates a random bgc_test_* schema and drops only that schema in finally.
"""
import asyncio
import hashlib
import hmac
import io
import json
import os
import sys
import uuid
from pathlib import Path
import pytest
import pytest_asyncio
from cryptography.fernet import Fernet
from httpx import AsyncClient, ASGITransport
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]
os.environ["DATABASE_SCHEMA"] = "bgc_test_" + uuid.uuid4().hex
os.environ["JWT_SECRET"] = uuid.uuid4().hex + uuid.uuid4().hex
os.environ["DATA_ENCRYPTION_KEY"] = Fernet.generate_key().decode()
os.environ["APP_ENV"] = "test"
os.environ["EXPOSE_DEV_RESET_TOKEN"] = "true"
import server as s
from payout_providers import Paystack, Flutterwave, ProviderError
from production import decrypt, encrypt

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def http():
    from scripts.migrate import migrate
    from sqlalchemy import text
    schema = s.db.schema
    assert schema.startswith("bgc_test_")
    migrate(os.environ.get("TEST_DATABASE_URL_UNPOOLED", os.environ["TEST_DATABASE_URL"]), schema)
    try:
        await s.on_start()
        for m in json.loads((Path(__file__).parents[1]/"scripts/website_markets.json").read_text()):
            await s.db.markets.insert_one(m)
        async with AsyncClient(transport=ASGITransport(app=s.app), base_url="http://test") as c:
            yield c
    finally:
        async with s.db.engine.begin() as c:
            await c.execute(text('DROP SCHEMA "' + schema + '" CASCADE'))
        await s.db.close()



@pytest_asyncio.fixture(loop_scope="session")
async def actors(http):
    uid, aid = uuid.uuid4().hex, uuid.uuid4().hex
    user={"id":uid,"full_name":"Test Customer","email":uid+"@example.com","phone":uid,
        "role":"customer","currency":"NGN","market_code":"NG","minor_digits":2,
        "password_hash":s.hash_pw("test-password-123"),"pin_hash":s.hash_pw("5829")}
    admin={**user,"id":aid,"email":aid+"@example.com","phone":aid,"role":"admin",
        "staff_role":"manager","staff_permissions":[],"password_hash":s.hash_pw("test-password-123@admin")}
    await s.db.users.insert_many([dict(user),dict(admin)])
    uh={"Authorization":"Bearer "+s.make_token(user)};ah={"Authorization":"Bearer "+s.make_token(admin)}
    account=(await http.post("/api/payout-accounts",headers=uh,json={"provider_name":"Company Bank","account_number":"0123456789","account_name":"Test Customer"})).json()
    return user,admin,uh,ah,account


async def credit(user, amount=10000):
    await s.db.ledger.insert_one({"id":uuid.uuid4().hex,"dedup_key":uuid.uuid4().hex,"user_id":user["id"],"amount_kobo":amount,"currency":user.get("currency","NGN"),"type":"TEST_CREDIT"})


async def withdrawal(http, a, amount=7000, key=None):
    return await http.post("/api/withdrawals",headers={**a[2],"Idempotency-Key":key or uuid.uuid4().hex},
        json={"amount_kobo":amount,"payout_account_id":a[4]["id"],"pin":"5829"})


async def trade(http,a):
    b=await http.post("/api/admin/brands",headers=a[3],json={"name":"Test Card","is_popular":True})
    assert b.status_code==200,b.text
    bid=b.json()["id"]
    r=await http.post("/api/admin/card-rates",headers=a[3],json={"brand_id":bid,"market_code":"NG","face_value":100,"payout_minor":850000})
    assert r.status_code==200,r.text
    body={"brand_id":bid,"submission_type":"ecode","card_value_usd":100,"rate_version":r.json()["version"],"ecode":"PRIVATE-CARD-123456"}
    result=await http.post("/api/trades",headers=a[2],json=body)
    assert result.status_code==200,result.text
    return result.json(),body



"""Real MongoDB transaction tests; provider HTTP is simulated, never real money.

Run with TEST_MONGO_URL pointing to a disposable local replica set. Every run
uses a fresh bgc_test_* database and cleans up only that database.
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
os.environ["MONGO_URL"] = os.environ.get("TEST_MONGO_URL", "mongodb://127.0.0.1:27028/?replicaSet=bringtest")
os.environ["DB_NAME"] = "bgc_test_" + uuid.uuid4().hex
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
    await s.on_start()
    for m in json.loads((Path(__file__).parents[1]/"scripts/website_markets.json").read_text()):
        await s.db.markets.insert_one(m)
    async with AsyncClient(transport=ASGITransport(app=s.app), base_url="http://test") as c:
        yield c
    assert s.DB_NAME.startswith("bgc_test_")
    await s.client.drop_database(s.DB_NAME)
    s.client.close()


@pytest_asyncio.fixture(loop_scope="session")
async def actors(http):
    uid, aid = uuid.uuid4().hex, uuid.uuid4().hex
    user={"id":uid,"full_name":"Test Customer","email":uid+"@example.com","phone":uid,
        "role":"customer","currency":"NGN","market_code":"NG","minor_digits":2,
        "password_hash":s.hash_pw("test-password-123"),"pin_hash":s.hash_pw("5829")}
    admin={**user,"id":aid,"email":aid+"@example.com","phone":aid,"role":"admin"}
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


async def test_concurrent_withdrawals_cannot_overspend(http,actors):
    await credit(actors[0])
    results=await asyncio.gather(withdrawal(http,actors),withdrawal(http,actors))
    assert sorted(r.status_code for r in results)==[200,400]
    assert await s.balance_kobo(actors[0]["id"])==3000


async def test_withdrawal_retry_is_idempotent(http,actors):
    await credit(actors[0]);key=uuid.uuid4().hex
    results=await asyncio.gather(withdrawal(http,actors,4000,key),withdrawal(http,actors,4000,key))
    assert all(r.status_code==200 for r in results)
    assert results[0].json()["id"]==results[1].json()["id"]
    assert await s.balance_kobo(actors[0]["id"])==6000
    assert (await withdrawal(http,actors,3000,key)).status_code==409


async def test_approval_and_credit_commit_once(http,actors):
    t,_=await trade(http,actors)
    responses=await asyncio.gather(*[http.post(f'/api/admin/trades/{t["id"]}/approve',headers=actors[3],json={}) for _ in range(3)])
    assert all(r.status_code==200 for r in responses),[r.text for r in responses]
    assert await s.balance_kobo(actors[0]["id"])==850000
    assert (await http.post(f'/api/admin/trades/{t["id"]}/need-info',headers=actors[3],json={"reason":"late"})).status_code==409


async def test_approval_rejection_race_preserves_consistency(http,actors):
    t,_=await trade(http,actors)
    await asyncio.gather(http.post(f'/api/admin/trades/{t["id"]}/approve',headers=actors[3],json={}),http.post(f'/api/admin/trades/{t["id"]}/reject',headers=actors[3],json={"reason":"invalid"}))
    row=await s.db.trades.find_one({"id":t["id"]})
    assert await s.balance_kobo(actors[0]["id"])==(850000 if row["status"]=="APPROVED" else 0)


async def test_payment_rejection_race_never_refunds_paid(http,actors):
    await credit(actors[0]);w=(await withdrawal(http,actors)).json()
    await asyncio.gather(http.post(f'/api/admin/withdrawals/{w["id"]}/paid',headers=actors[3],json={"external_reference":"actual-bank-ref"}),http.post(f'/api/admin/withdrawals/{w["id"]}/reject',headers=actors[3],json={"reason":"invalid account"}))
    row=await s.db.withdrawals.find_one({"id":w["id"]})
    assert await s.balance_kobo(actors[0]["id"])==(3000 if row["status"]=="PAID" else 10000)


async def test_rejection_releases_once(http,actors):
    await credit(actors[0]);w=(await withdrawal(http,actors)).json()
    for _ in range(2):
        assert (await http.post(f'/api/admin/withdrawals/{w["id"]}/reject',headers=actors[3],json={"reason":"incorrect details"})).status_code==200
    assert await s.balance_kobo(actors[0]["id"])==10000


async def test_rate_changes_propagate_and_stale_quote_fails(http,actors):
    t,body=await trade(http,actors)
    saved=await http.post("/api/admin/card-rates",headers=actors[3],json={"brand_id":t["brand_id"],"market_code":"NG","face_value":100,"payout_minor":900000})
    assert saved.status_code==200
    current=(await http.get(f'/api/card-rates?brand_id={t["brand_id"]}&market_code=NG')).json()
    assert current["rates"][0]["payout_minor"]==900000
    assert (await http.post("/api/trades",headers=actors[2],json=body)).status_code==409
    original=await s.db.trades.find_one({"id":t["id"]})
    assert original["expected_payout_kobo"]==850000


async def test_ecode_encrypted_and_not_exposed(http,actors):
    t,_=await trade(http,actors)
    row=await s.db.trades.find_one({"id":t["id"]})
    assert "ecode" not in row and "PRIVATE-CARD" not in row["ecode_encrypted"]
    assert "ecode_encrypted" not in t and "ecode" not in t
    detail=await http.get(f'/api/admin/trades/{t["id"]}',headers=actors[3])
    assert detail.json()["ecode"]=="PRIVATE-CARD-123456"


async def test_customer_cannot_change_admin_configuration(http,actors):
    for path in ["/api/admin/markets","/api/admin/payout-providers","/api/admin/readiness","/api/admin/brands"]:
        assert (await http.get(path,headers=actors[2])).status_code==403
        assert (await http.get(path)).status_code==401


async def test_kyc_blocked_at_backend(http,actors):
    assert (await http.get("/api/kyc",headers=actors[2])).status_code==404
    assert (await http.get("/api/admin/kyc",headers=actors[3])).status_code==404


async def test_files_reject_query_tokens_and_cross_user_paths(http,actors):
    p="bring-gift-card/uploads/other/image.jpg"
    assert (await http.get("/api/files/"+p+"?token="+s.make_token(actors[0]))).status_code==401
    assert (await http.get("/api/files/"+p,headers=actors[2])).status_code==403
    t,body=await trade(http,actors);body.update(submission_type="physical",image_paths=[p])
    assert (await http.post("/api/trades",headers=actors[2],json=body)).status_code==403


async def test_upload_validates_content_and_ownership(http,actors,monkeypatch):
    monkeypatch.setattr(s,"_put_object",lambda *args:{})
    bad=await http.post("/api/uploads",headers=actors[2],files={"file":("fake.jpg",b"<script>x</script>","image/jpeg")})
    assert bad.status_code==422
    b=io.BytesIO();Image.new("RGB",(20,20)).save(b,format="PNG")
    good=await http.post("/api/uploads",headers=actors[2],files={"file":("card.png",b.getvalue(),"image/png")})
    assert good.status_code==200,good.text
    assert await s.db.uploads.find_one({"path":good.json()["path"],"user_id":actors[0]["id"]})


async def test_country_currency_signup_and_immutable_market(http,actors):
    tag=uuid.uuid4().hex
    res=await http.post("/api/auth/signup",json={"full_name":"Cameroon Customer","email":tag+"@example.com","phone":tag[:24],"password":"secure-password","market_code":"CM","accepted_terms":True})
    assert res.status_code==200,res.text
    assert res.json()["user"]["currency"]=="XAF" and res.json()["user"]["minor_digits"]==0
    assert (await http.post("/api/admin/markets",headers=actors[3],json={"code":"NG","name":"Nigeria","currency":"USD"})).status_code==409


async def test_password_reset_single_use_revokes_existing_session(http,actors):
    reset=await http.post("/api/auth/password-reset/request",json={"email":actors[0]["email"]})
    token=reset.json()["dev_token"]
    r=await http.post("/api/auth/password-reset/confirm",json={"token":token,"password":"new-password-123"})
    assert r.status_code==200,r.text
    assert (await http.get("/api/auth/me",headers=actors[2])).status_code==401
    assert (await http.post("/api/auth/password-reset/confirm",json={"token":token,"password":"other-password"})).status_code==400


async def test_no_email_does_not_fake_delivery(http,actors,monkeypatch):
    monkeypatch.setattr(s,"EXPOSE_DEV_RESET_TOKEN",False);monkeypatch.delenv("SMTP_HOST",raising=False)
    assert (await http.post("/api/auth/password-reset/request",json={"email":actors[0]["email"]})).status_code==503


async def configure_provider(http,a):
    pid="p"+uuid.uuid4().hex
    r=await http.post("/api/admin/payout-providers/"+pid,headers=a[3],json={"label":"Paystack test","adapter":"paystack","enabled":True,"secret":"test-secret"})
    assert r.status_code==200,r.text
    return pid


async def test_provider_secrets_never_returned(http,actors):
    pid=await configure_provider(http,actors)
    row=await s.db.payout_providers.find_one({"id":pid})
    assert row["secret"]!="test-secret" and decrypt(row["secret"])=="test-secret"
    result=await http.get("/api/admin/payout-providers",headers=actors[3])
    assert "test-secret" not in result.text and row["secret"] not in result.text
    assert (await http.post("/api/admin/payout-providers/custom",headers=actors[3],json={"label":"Custom","adapter":"unknown","enabled":True,"secret":"key"})).status_code==409


async def test_provider_timeout_holds_funds_blocks_resend_and_manual_refund(http,actors,monkeypatch):
    pid=await configure_provider(http,actors)
    await s.db.payout_accounts.update_one({"id":actors[4]["id"]},{"$set":{"verified":True,"payout_provider_id":pid,"bank_code":"058"}})
    async def fail(*args):raise ProviderError("timeout")
    monkeypatch.setattr(Paystack,"send",fail)
    await credit(actors[0]);w=(await withdrawal(http,actors)).json()
    url=f'/api/admin/withdrawals/{w["id"]}'
    result=await http.post(url+"/dispatch",headers=actors[3],json={"provider_id":pid})
    assert result.status_code==200 and result.json()["status"]=="PROCESSING"
    assert (await http.post(url+"/dispatch",headers=actors[3],json={"provider_id":pid})).status_code==409
    assert (await http.post(url+"/reject",headers=actors[3],json={"reason":"timeout"})).status_code==409
    assert await s.balance_kobo(actors[0]["id"])==3000


async def test_provider_verification_checks_amount_and_signed_webhook(http,actors,monkeypatch):
    pid=await configure_provider(http,actors)
    await s.db.payout_accounts.update_one({"id":actors[4]["id"]},{"$set":{"verified":True,"payout_provider_id":pid,"bank_code":"058"}})
    async def queued(*args):return {"id":1,"status":"pending"}
    monkeypatch.setattr(Paystack,"send",queued)
    await credit(actors[0]);w=(await withdrawal(http,actors)).json();url=f'/api/admin/withdrawals/{w["id"]}'
    await http.post(url+"/dispatch",headers=actors[3],json={"provider_id":pid})
    response={"reference":"bgc-"+w["id"],"currency":"NGN","amount":7001,"status":"success","recipient":{"details":{"account_number":"0123456789","bank_code":"058"}}}
    async def verify(*args):return response
    monkeypatch.setattr(Paystack,"verify",verify)
    assert (await http.post(url+"/reconcile",headers=actors[3])).status_code==409
    response["amount"]=7000
    raw=json.dumps({"event":"transfer.success","data":{"reference":response["reference"]}}).encode()
    hook="/api/webhooks/payouts/"+pid
    assert (await http.post(hook,content=raw)).status_code==401
    signature=hmac.new(b"test-secret",raw,hashlib.sha512).hexdigest()
    for _ in range(2):
        assert (await http.post(hook,content=raw,headers={"x-paystack-signature":signature})).status_code==200
    row=await s.db.withdrawals.find_one({"id":w["id"]});assert row["status"]=="PAID"
    response["status"]="reversed"
    assert (await http.post(url+"/reconcile",headers=actors[3])).status_code==200
    assert await s.balance_kobo(actors[0]["id"])==10000


async def test_flutterwave_amount_and_signature_contract():
    adapter=Flutterwave("secret","hook")
    assert adapter.signature_valid(b"anything",{"verif-hash":"hook"})
    assert not adapter.signature_valid(b"anything",{"verif-hash":"bad"})
    assert adapter.amount_minor({"amount":"12.34"})==1234
    assert adapter.state({"status":"NEW"})=="PROCESSING"
    assert adapter.state({"status":"SUCCESSFUL"})=="PAID"


async def test_ledger_failure_rolls_back_approval(http,actors,monkeypatch):
    t,_=await trade(http,actors)
    async def fail(*args,**kwargs): raise RuntimeError("simulated storage failure")
    monkeypatch.setattr(s.money,"event",fail)
    with pytest.raises(RuntimeError):
        await s.money.review(t["id"],"APPROVED",actors[1])
    assert await s.balance_kobo(actors[0]["id"])==0
    assert (await s.db.trades.find_one({"id":t["id"]}))["status"]=="PENDING_REVIEW"


async def test_parallel_pin_guesses_cannot_bypass_lock(http,actors):
    async def guess():
        try: await s.verify_pin_or_raise(actors[0],"9998")
        except s.HTTPException as exc: return exc.status_code
    statuses=await asyncio.gather(*[guess() for _ in range(s.PIN_MAX_ATTEMPTS+2)])
    assert 423 in statuses
    with pytest.raises(s.HTTPException) as exc:
        await s.verify_pin_or_raise(actors[0],"5829")
    assert exc.value.status_code==423


async def test_zero_decimal_withdrawal_receipt(http,actors):
    await s.db.users.update_one({"id":actors[0]["id"]},{"$set":{"currency":"XAF","minor_digits":0,"market_code":"CM"}})
    await s.db.payout_accounts.update_one({"id":actors[4]["id"]},{"$set":{"currency":"XAF"}})
    await credit({**actors[0],"currency":"XAF"})
    r=await withdrawal(http,actors,1234)
    assert r.status_code==200,r.text
    w=r.json();assert w["currency"]=="XAF" and w["minor_digits"]==0
    assert (await http.post(f'/api/admin/withdrawals/{w["id"]}/paid',headers=actors[3],json={"external_reference":"BANK-TEST-123"})).status_code==200
    receipt=(await http.get(f'/api/receipts/withdrawal/{w["id"]}',headers=actors[2])).json()
    assert receipt["total_kobo"]==1234 and receipt["minor_digits"]==0
    assert any(line["value"]=="BANK-TEST-123" for line in receipt["lines"])


async def test_disabling_rate_and_card_blocks_quotes(http,actors):
    t,body=await trade(http,actors)
    assert (await http.delete('/api/admin/card-rates/'+t["rate_id"],headers=actors[3])).status_code==200
    assert (await http.post('/api/trades',headers=actors[2],json=body)).status_code==409
    await s.db.brands.update_one({"id":t["brand_id"]},{"$set":{"is_active":False}})
    assert not (await http.get('/api/card-rates?brand_id='+t["brand_id"])).json()["rates"]


async def test_provider_send_payload_contracts(monkeypatch):
    calls=[]
    async def request(self,method,path,**kwargs):
        calls.append((method,path,kwargs))
        return {"recipient_code":"RCP_test","id":42}
    from payout_providers import BankProvider
    monkeypatch.setattr(BankProvider,"request",request)
    w={"destination":{"bank_code":"058","account_number":"0123456789","account_name":"Test"},"currency":"NGN","amount_kobo":12345,"provider_reference":"bgc-test","ref":"TEST"}
    await Paystack("key").send(w)
    assert calls[-1][2]["json"]["amount"]==12345
    assert calls[-1][2]["json"]["reference"]=="bgc-test"
    await Flutterwave("key").send(w)
    assert calls[-1][2]["json"]["amount"]==123.45


async def test_support_attachment_access_is_ticket_scoped(http,actors,monkeypatch):
    path=f'bring-gift-card/uploads/{actors[1]["id"]}/test.jpg'
    monkeypatch.setattr(s,"_get_object",lambda p:(b"test-image","image/jpeg"))
    assert (await http.get('/api/files/'+path,headers=actors[2])).status_code==403
    tid=uuid.uuid4().hex
    await s.db.support_tickets.insert_one({"id":tid,"user_id":actors[0]["id"]})
    await s.db.support_messages.insert_one({"ticket_id":tid,"sender":"admin","image_paths":[path]})
    response=await http.get('/api/files/'+path,headers=actors[2])
    assert response.status_code==200 and response.content==b"test-image"


async def test_denomination_history_includes_update_and_disable(http,actors):
    t,_=await trade(http,actors)
    await http.delete('/api/admin/card-rates/'+t['rate_id'],headers=actors[3])
    rows=(await http.get('/api/admin/denomination-history',headers=actors[3])).json()['changes']
    related=[r for r in rows if r['target']==t['rate_id']]
    assert {r['action'] for r in related}=={'rate.updated','rate.disabled'}
    assert all(r['rate']['face_value']==100 and r['market']['currency']=='NGN' for r in related)

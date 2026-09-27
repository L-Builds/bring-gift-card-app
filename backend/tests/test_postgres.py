"""SQL constraint, rollback and multi-connection concurrency acceptance."""
import asyncio
import uuid
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from tests.test_production import s, credit, withdrawal, trade, configure_provider
from payout_providers import Paystack
from persistence import Database, DuplicateKeyError

pytestmark = pytest.mark.asyncio(loop_scope='session')


async def test_withdrawal_failure_rolls_back_every_record(http, actors, monkeypatch):
    await credit(actors[0])
    async def fail(*args,**kwargs): raise RuntimeError('injected audit failure')
    monkeypatch.setattr(s.money,'event',fail)
    with pytest.raises(RuntimeError): await withdrawal(http,actors)
    assert await s.balance_kobo(actors[0]['id']) == 10000
    assert await s.db.withdrawals.count_documents({'user_id':actors[0]['id']}) == 0
    assert await s.db.ledger.count_documents({'user_id':actors[0]['id']}) == 1


async def test_many_parallel_withdrawals_use_separate_connections(http,actors):
    await credit(actors[0],10000)
    results = await asyncio.gather(*[withdrawal(http,actors,4000) for _ in range(8)])
    assert [r.status_code for r in results].count(200) == 2
    assert [r.status_code for r in results].count(400) == 6
    assert await s.balance_kobo(actors[0]['id']) == 2000


async def test_ledger_database_guards_cannot_be_bypassed(http,actors):
    uid=actors[0]['id'];await credit(actors[0],10000)
    for statement in ["UPDATE ledger SET amount_kobo=90000 WHERE user_id=:uid", "DELETE FROM ledger WHERE user_id=:uid"]:
        with pytest.raises(IntegrityError):
            async with s.db.connection() as c: await c.execute(text(statement),{'uid':uid})
    with pytest.raises(IntegrityError):
        await credit(actors[0],-10001)
    with pytest.raises(IntegrityError):
        await credit({**actors[0],'currency':'USD'},10)
    with pytest.raises(IntegrityError):
        await s.db.users.update_one({'id':uid},{'$set':{'currency':'USD'}})
    assert await s.balance_kobo(uid)==10000


async def test_duplicate_reference_rejected_even_with_new_dedup_key(http,actors):
    t,_=await trade(http,actors)
    assert (await http.post('/api/admin/trades/'+t['id']+'/approve',headers=actors[3],json={})).status_code==200
    row=await s.db.ledger.find_one({'ref_id':t['id']});row.pop('_id');row.update(id=uuid.uuid4().hex,dedup_key=uuid.uuid4().hex)
    with pytest.raises(DuplicateKeyError):await s.db.ledger.insert_one(row)
    assert await s.balance_kobo(actors[0]['id'])==850000


async def test_foreign_keys_and_withdrawal_idempotency_constraint(http,actors):
    with pytest.raises(IntegrityError):await credit({'id':'nonexistent-user','currency':'NGN'},10)
    await credit(actors[0]);w=(await withdrawal(http,actors)).json()
    row=await s.db.withdrawals.find_one({'id':w['id']});row.pop('_id');row['id']=uuid.uuid4().hex
    with pytest.raises(DuplicateKeyError):await s.db.withdrawals.insert_one(row)


async def test_two_database_instances_cannot_double_credit(http,actors):
    t,_=await trade(http,actors)
    from money import Money
    from types import SimpleNamespace
    other=Database(s.DATABASE_URL,s.db.schema)
    service=Money(SimpleNamespace(db=other,new_id=s.new_id,now=s.now))
    try:
        results=await asyncio.gather(s.money.review(t['id'],'APPROVED',actors[1]),service.review(t['id'],'APPROVED',actors[1]))
        assert sum(r['credited'] for r in results)==1
        assert await s.balance_kobo(actors[0]['id'])==850000
    finally:await other.close()


async def test_concurrent_rate_upserts_preserve_versions_and_audit(http,actors):
    t,_=await trade(http,actors)
    async def save(amount):return await http.post('/api/admin/card-rates',headers=actors[3],json={'brand_id':t['brand_id'],'market_code':'NG','face_value':100,'payout_minor':amount})
    results=await asyncio.gather(*[save(900000+n) for n in range(5)])
    assert all(r.status_code==200 for r in results),[r.text for r in results]
    assert sorted(r.json()['version'] for r in results)==[2,3,4,5,6]
    assert await s.db.card_rates.count_documents({'brand_id':t['brand_id']})==1
    assert await s.db.audit.count_documents({'target':t['rate_id'],'action':'rate.updated'})==6


async def test_parallel_dispatch_calls_provider_once(http,actors,monkeypatch):
    pid=await configure_provider(http,actors)
    await s.db.payout_accounts.update_one({'id':actors[4]['id']},{'$set':{'verified':True,'payout_provider_id':pid,'bank_code':'058'}})
    calls=[]
    async def send(*args):calls.append(1);await asyncio.sleep(.1);return {'id':42,'status':'pending'}
    monkeypatch.setattr(Paystack,'send',send)
    await credit(actors[0]);w=(await withdrawal(http,actors)).json()
    async def dispatch():return await http.post('/api/admin/withdrawals/'+w['id']+'/dispatch',headers=actors[3],json={'provider_id':pid})
    results=await asyncio.gather(*[dispatch() for _ in range(5)])
    assert sorted(r.status_code for r in results)==[200,409,409,409,409]
    assert len(calls)==1 and await s.balance_kobo(actors[0]['id'])==3000


async def test_dispatch_reject_race_never_sends_refunded_money(http,actors,monkeypatch):
    pid=await configure_provider(http,actors)
    await s.db.payout_accounts.update_one({'id':actors[4]['id']},{'$set':{'verified':True,'payout_provider_id':pid,'bank_code':'058'}})
    calls=[]
    async def send(*args):calls.append(1);return {'id':1,'status':'pending'}
    monkeypatch.setattr(Paystack,'send',send)
    await credit(actors[0]);w=(await withdrawal(http,actors)).json();url='/api/admin/withdrawals/'+w['id']
    results=await asyncio.gather(http.post(url+'/dispatch',headers=actors[3],json={'provider_id':pid}),http.post(url+'/reject',headers=actors[3],json={'reason':'test rejection'}))
    assert sorted(r.status_code for r in results)==[200,409]
    row=await s.db.withdrawals.find_one({'id':w['id']})
    if row['status']=='REJECTED':assert not calls and await s.balance_kobo(actors[0]['id'])==10000
    else:assert row['status']=='PROCESSING' and len(calls)==1 and await s.balance_kobo(actors[0]['id'])==3000


async def test_atomic_abuse_counter_across_connections(http):
    from persistence import ReturnDocument
    key=uuid.uuid4().hex
    results=await asyncio.gather(*[s.db.abuse_counters.find_one_and_update({'_id':key},{'$inc':{'count':1}},upsert=True,return_document=ReturnDocument.AFTER) for _ in range(15)])
    assert sorted(r['count'] for r in results)==list(range(1,16))


async def test_parallel_reset_token_is_single_use(http,actors):
    # Insert a token directly to avoid coupling this race test to email/rate limits.
    import hashlib
    from datetime import timedelta
    token=uuid.uuid4().hex
    await s.db.password_resets.insert_one({'id':uuid.uuid4().hex,'user_id':actors[0]['id'],'token_hash':hashlib.sha256(token.encode()).hexdigest(),'used':False,'expires_at':s.now()+timedelta(minutes=5)})
    async def reset():return await s.reset_confirm(s.ResetConfirmIn(token=token,password='new-secure-password'))
    results=await asyncio.gather(reset(),reset(),return_exceptions=True)
    assert sum(isinstance(r,dict) for r in results)==1
    assert sum(isinstance(r,s.HTTPException) and r.status_code==400 for r in results)==1


async def test_support_and_search_contracts(http,actors):
    t,_=await trade(http,actors)
    ticket=await http.post('/api/support/tickets',headers=actors[2],json={'subject':'Migration support','message':'Please check this trade','category':'trade','ref_type':'trade','ref_id':t['id']})
    assert ticket.status_code==200,ticket.text
    tid=ticket.json()['id']
    response=await http.post('/api/admin/support/'+tid+'/reply',headers=actors[3],json={'body':'We are reviewing this'})
    assert response.status_code==200,response.text
    details=(await http.get('/api/support/tickets/'+tid,headers=actors[2])).json()
    assert details['ticket']['status']=='AWAITING_CUSTOMER' and len(details['messages'])==2
    assert (await http.get('/api/admin/support?status=all&q=Migration',headers=actors[3])).json()['tickets']
    assert (await http.get('/api/admin/users?q='+actors[0]['email'],headers=actors[3])).json()['users']
    assert (await http.get('/api/admin/users/'+actors[0]['id'],headers=actors[3])).json()['tickets'][0]['id']==tid
    assert (await http.post('/api/support/tickets/'+tid+'/close',headers=actors[2])).status_code==200


async def test_catalog_filter_and_rate_history_sql_aggregation(http,actors):
    t,_=await trade(http,actors)
    b=(await http.get('/api/brands/'+t['brand_id'])).json()
    body={k:b[k] for k in s.BrandIn.model_fields if k in b};body['rate_kobo_per_usd']=20
    assert (await http.patch('/api/admin/brands/'+b['id'],headers=actors[3],json=body)).status_code==200
    history=(await http.get('/api/admin/rate-history?brand_id='+b['id'],headers=actors[3])).json()
    assert history['changes'][0]['new']==20 and any(r['brand_id']==b['id'] and r['count']==1 for r in history['brands'])
    assert (await http.get('/api/brands?q=Test%20Card')).json()['brands']
    assert 'All' in (await http.get('/api/categories')).json()['categories']


async def test_chunk_upload_retries_ownership_and_range_download(http,actors,monkeypatch):
    import io
    from PIL import Image
    from upload_transport import CHUNK
    # Incompressible RGB data exercises multiple chunks and real image validation.
    import os
    image=Image.frombytes('RGB',(1200,1200),os.urandom(1200*1200*3))
    out=io.BytesIO();image.save(out,format='PNG');data=out.getvalue()
    assert CHUNK < len(data) < 12*1024*1024
    stored={}
    async def save(path,body):stored[path]=body
    monkeypatch.setattr(s,'store_image',save)
    start=await http.post('/api/uploads/chunks',headers=actors[2],json={'size':len(data)})
    assert start.status_code==200,start.text
    url='/api/uploads/chunks/'+start.json()['id']
    assert (await http.post(url+'/complete',headers=actors[2])).status_code==409
    assert (await http.put(url+'/0',headers=actors[3],content=data[:CHUNK])).status_code==404
    for index,offset in enumerate(range(0,len(data),CHUNK)):
        part=data[offset:offset+CHUNK]
        for _ in range(2):assert (await http.put(url+'/'+str(index),headers=actors[2],content=part)).status_code==200
    assert (await http.put(url+'/0',headers=actors[2],content=b'x'*CHUNK)).status_code==409
    done=await http.post(url+'/complete',headers=actors[2]);assert done.status_code==200,done.text
    assert (await http.post(url+'/complete',headers=actors[2])).json()==done.json()
    path=done.json()['path'];assert stored[path][:2]==b'\xff\xd8'
    assert await s.db.upload_parts.count_documents({'session_id':start.json()['id']})==0
    monkeypatch.setattr(s,'_get_object',lambda p:(stored[p],'image/jpeg'))
    response=await http.get('/api/files/'+path,headers={**actors[2],'Range':'bytes=0-99'})
    assert response.status_code==206 and response.content==stored[path][:100]
    assert response.headers['content-range']==f'bytes 0-99/{len(stored[path])}'
    assert (await http.get('/api/files/'+path,headers={'Range':'bytes=0-99'})).status_code==401


async def test_chunk_expiry_and_cleanup_require_cron_secret(http,actors,monkeypatch):
    from datetime import timedelta
    uid=uuid.uuid4().hex
    await s.db.upload_sessions.insert_one({'id':uid,'user_id':actors[0]['id'],'size':1,'expires_at':s.now()-timedelta(seconds=1)})
    await s.db.upload_parts.insert_one({'session_id':uid,'part':0,'data':b'x','sha256':'x'})
    assert (await http.post('/api/uploads/chunks/'+uid+'/complete',headers=actors[2])).status_code==404
    monkeypatch.setenv('CRON_SECRET','test-cron-secret')
    assert (await http.get('/api/internal/cleanup-expired')).status_code==401
    r=await http.get('/api/internal/cleanup-expired',headers={'Authorization':'Bearer test-cron-secret'})
    assert r.status_code==200,r.text
    assert not await s.db.upload_sessions.find_one({'id':uid})
    assert await s.db.upload_parts.count_documents({'session_id':uid})==0

"""Offline transfer acceptance; use a disposable Mongo replica set only.

Run separately with TEST_MONGO_URL and TEST_DATABASE_URL. Mongo driver is an
optional migration-test dependency, never part of the API runtime.
"""
import os
import uuid
import pytest
from sqlalchemy import text
from tests.pg_support import s, trade, withdrawal
from scripts.migrate import migrate
from scripts.export_mongo import COLLECTIONS, export
from scripts.import_snapshot import import_snapshot
from persistence import Database

pytestmark=pytest.mark.asyncio(loop_scope='session')


async def test_real_mongo_export_postgres_verified_cutover(http,actors,tmp_path):
    from pymongo import MongoClient
    url=os.environ['TEST_MONGO_URL']
    # Build a complete representative source, including a credited trade and debit.
    t,_=await trade(http,actors)
    assert (await http.post('/api/admin/trades/'+t['id']+'/approve',headers=actors[3],json={})).status_code==200
    assert (await withdrawal(http,actors)).status_code==200
    source_name='bgc_transfer_test_'+uuid.uuid4().hex
    target_name='bgc_test_transfer_'+uuid.uuid4().hex
    direct=os.environ.get('TEST_DATABASE_URL_UNPOOLED',os.environ['TEST_DATABASE_URL'])
    client=MongoClient(url,tz_aware=True)
    target=Database(direct,target_name)
    try:
        for name in COLLECTIONS:
            rows=await s.db[name].find({}).to_list()
            if rows:client[source_name][name].insert_many(rows)
        manifest=export(url,source_name,tmp_path/'snapshot')
        migrate(direct,target_name)
        migrate(direct,target_name)  # Repeating migrations is safe.
        dry=await import_snapshot(target,tmp_path/'snapshot')
        assert not dry['applied'] and dry['balances_match'] and dry['records']>0
        assert await target.users.count_documents({})==0
        # An invalid source digest rolls back every imported record.
        import json
        path=tmp_path/'snapshot'/'manifest.json'; original=path.read_text()
        changed=json.loads(original);changed['collections']['users']['records_digest']='0'*64
        path.write_text(json.dumps(changed))
        with pytest.raises(ValueError,match='Record parity'):await import_snapshot(target,tmp_path/'snapshot',True)
        assert await target.users.count_documents({})==0
        path.write_text(original)
        result=await import_snapshot(target,tmp_path/'snapshot',True)
        assert result['applied'] and result['balances_match'] and result['records']==dry['records']
        with pytest.raises(ValueError,match='not empty'):await import_snapshot(target,tmp_path/'snapshot',True)
        for name,info in manifest['collections'].items():
            assert client[source_name][name].count_documents({})==info['count']
    finally:
        assert source_name.startswith('bgc_transfer_test_')
        client.drop_database(source_name);client.close()
        assert target_name.startswith('bgc_test_transfer_')
        async with target.engine.begin() as c:await c.execute(text('DROP SCHEMA IF EXISTS "'+target_name+'" CASCADE'))
        await target.close()

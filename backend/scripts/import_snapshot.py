"""Verified, all-or-nothing offline import into an empty PostgreSQL target.

Default dry run exercises all constraints and verifies every record and balance,
then rolls back. --apply commits only after parity checks pass. Never deletes the
MongoDB source. Use a separate Neon migration branch first, then a stopped-writer
cutover. Existing JWT/encryption secrets and private storage objects must be kept.
"""
import argparse
import asyncio
import hashlib
import json
import os
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv
from sqlalchemy import text
from persistence import Database, decode
from schema import metadata
from scripts.export_mongo import COLLECTIONS, digest_add


class DryRunRollback(Exception):pass


async def import_snapshot(database, directory, apply=False):
    directory=Path(directory)
    manifest=json.loads((directory/'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('format')!='bgc-postgres-transfer-v1' or set(manifest.get('collections',{}))!=set(COLLECTIONS):
        raise ValueError('Unexpected transfer format or collection list')
    for name,expected in manifest['collections'].items():
        if hashlib.sha256((directory/(name+'.jsonl')).read_bytes()).hexdigest()!=expected['sha256']:
            raise ValueError('Snapshot checksum mismatch: '+name)
    await database.check_schema()
    report={'applied':False,'records':0,'collections':{},'balances_match':False}
    async def run(c):
        # Lock the empty target through verification/commit; no API writer can
        # race the emptiness check or observe a partially imported database.
        for table in metadata.sorted_tables:
            await c.execute(text('LOCK TABLE "'+table.name+'" IN ACCESS EXCLUSIVE MODE'))
            if await database[table.name].count_documents({},session=c):raise ValueError('Target is not empty: '+table.name)
        for table in sorted(metadata.sorted_tables, key=lambda table: table.name == 'ledger'):
            name=table.name
            if name not in COLLECTIONS:continue
            repo=database[name]
            with (directory/(name+'.jsonl')).open(encoding='utf-8') as file:
                for line in file:
                    if line.strip():await repo.insert_one(decode(json.loads(line)),session=c)
        await c.execute(text('SET CONSTRAINTS ALL IMMEDIATE'))
        balances={}
        for name in COLLECTIONS:
            count=digest=0
            async for row in database[name].find({},session=c):
                count+=1;digest=digest_add(digest,row)
                if name=='ledger':
                    key=row['user_id']+':'+row['currency'];balances[key]=balances.get(key,0)+row['amount_kobo']
            expected=manifest['collections'][name]
            if count!=expected['count'] or f'{digest:064x}'!=expected['records_digest']:
                raise ValueError('Record parity failed: '+name)
            report['collections'][name]=count;report['records']+=count
        if balances!=manifest['balances']:raise ValueError('Wallet balance parity failed')
        report['balances_match']=True
        if not apply:raise DryRunRollback()
    try:await database.transaction(run)
    except DryRunRollback:pass
    else:report['applied']=True
    return report


async def main(args):
    load_dotenv(Path(__file__).resolve().parents[1]/'.env')
    url=os.environ['DATABASE_URL_UNPOOLED']
    from urllib.parse import urlsplit
    if '-pooler' in (urlsplit(url).hostname or ''):raise ValueError('Use the direct migration connection')
    db=Database(url,os.environ.get('DATABASE_SCHEMA','public'))
    try:print(json.dumps(await import_snapshot(db,args.directory,args.apply),indent=2))
    finally:await db.close()


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('directory');p.add_argument('--apply',action='store_true')
    asyncio.run(main(p.parse_args()))

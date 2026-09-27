"""OFFLINE, read-only migration exporter; not imported by the running API.

Install pymongo==4.18.2 in a separate migration environment. Stop source writers
before final cutover. Keep this export encrypted/private: it contains credentials
and private business records. The source database is never modified or deleted.
"""
import argparse
import hashlib
import json
import os
from datetime import datetime
from pathlib import Path

COLLECTIONS = ['users','markets','brands','card_rates','payout_accounts','trades','withdrawals','ledger',
    'notifications','support_tickets','support_messages','uploads','password_resets','abuse_counters',
    'kyc_submissions','rate_changes','audit','payout_providers','settings','legal']


def encode(v):
    if isinstance(v,datetime):return {'$bgc_datetime':v.isoformat()}
    if isinstance(v,dict):return {k:encode(x) for k,x in v.items()}
    if isinstance(v,list):return [encode(x) for x in v]
    return v


def canonical(doc):
    return json.dumps(encode(doc),sort_keys=True,separators=(',',':'),ensure_ascii=False)


def digest_add(current,doc):
    return (current+int.from_bytes(hashlib.sha256(canonical(doc).encode()).digest(),'big')) % (1<<256)


def export(url, database, destination):
    from pymongo import MongoClient
    from bson import ObjectId
    output=Path(destination)
    output.mkdir(parents=True,exist_ok=False)
    manifest={'format':'bgc-postgres-transfer-v1','collections':{},'balances':{}}
    with MongoClient(url,tz_aware=True) as client:
        db=client[database]
        unknown=[n for n in db.list_collection_names() if n not in COLLECTIONS and not n.startswith('system.') and db[n].count_documents({})]
        if unknown:raise RuntimeError('Unmapped nonempty collections; review before migration: '+', '.join(unknown))
        with client.start_session(snapshot=True) as session:
            for name in COLLECTIONS:
                count=digest=0
                with (output/(name+'.jsonl')).open('w',encoding='utf-8',newline='\n') as file:
                    for row in db[name].find({},session=session):
                        if isinstance(row.get('_id'),ObjectId):row['_id']=str(row['_id'])
                        line=canonical(row)
                        file.write(line+'\n');count+=1;digest=digest_add(digest,row)
                        if name=='ledger':
                            key=row['user_id']+':'+row.get('currency','NGN')
                            manifest['balances'][key]=manifest['balances'].get(key,0)+row['amount_kobo']
                manifest['collections'][name]={'count':count,'records_digest':f'{digest:064x}',
                    'sha256':hashlib.sha256((output/(name+'.jsonl')).read_bytes()).hexdigest()}
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print('Snapshot export complete. '+str(sum(v['count'] for v in manifest['collections'].values()))+' records; source unchanged.')
    return manifest


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',required=True)
    args=p.parse_args()
    export(os.environ['SOURCE_MONGO_URL'],os.environ['SOURCE_DB_NAME'],args.output)

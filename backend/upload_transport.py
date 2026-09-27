"""Bounded authenticated transport for 12MB images on Vercel's 4.5MB gateway.

Chunks are temporary PostgreSQL BYTEA rows, never publicly readable. Completion
uses the existing image validation, re-encoding and private storage destination.
The legacy multipart endpoint remains available with its unchanged contract.
"""
import hashlib
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

CHUNK = 3 * 1024 * 1024
MAX_IMAGE = 12 * 1024 * 1024


class BeginUpload(BaseModel):
    size: int = Field(gt=0, le=MAX_IMAGE)


def router(s):
    api=APIRouter(prefix='/api/uploads/chunks')

    async def owned(uid,user,session):
        row=await s.db.upload_sessions.find_one({'id':uid,'user_id':user['id']},session=session,for_update=True)
        if not row or row['expires_at'] <= s.now():raise HTTPException(404,'Upload session not found or expired')
        return row

    @api.post('')
    async def begin(x:BeginUpload,user=Depends(s.current_user)):
        uid=s.new_id()
        await s.db.upload_sessions.insert_one({'id':uid,'user_id':user['id'],'size':x.size,'expires_at':s.now()+timedelta(hours=1)})
        return {'id':uid,'chunk_size':CHUNK}

    @api.put('/{uid}/{part}')
    async def part_upload(uid:str,part:int,request:Request,user=Depends(s.current_user)):
        body=bytearray()
        async for chunk in request.stream():
            if len(body)+len(chunk)>CHUNK:raise HTTPException(413,'Upload chunk exceeds 3MB')
            body.extend(chunk)
        data=bytes(body);digest=hashlib.sha256(data).hexdigest()
        async def run(session):
            row=await owned(uid,user,session)
            if row.get('path'):raise HTTPException(409,'Upload already completed')
            expected=min(CHUNK,row['size']-part*CHUNK)
            if part<0 or part>=4 or expected<=0 or len(data)!=expected:raise HTTPException(422,'Invalid upload chunk size or index')
            key={'session_id':uid,'part':part}
            old=await s.db.upload_parts.find_one(key,session=session)
            if old and old['sha256']!=digest:raise HTTPException(409,'Chunk already supplied with different data')
            if not old:await s.db.upload_parts.insert_one({**key,'data':data,'sha256':digest},session=session)
            return {'ok':True}
        return await s.db.transaction(run)

    @api.post('/{uid}/complete')
    async def complete(uid:str,user=Depends(s.current_user)):
        async def run(session):
            row=await owned(uid,user,session)
            if row.get('path'):return {'path':row['path']}
            parts=await s.db.upload_parts.find({'session_id':uid},session=session).sort('part',1).to_list(4)
            count=(row['size']+CHUNK-1)//CHUNK
            if len(parts)!=count or [p['part'] for p in parts]!=list(range(count)):
                raise HTTPException(409,'Upload is incomplete')
            data=b''.join(p['data'] for p in parts)
            if len(data)!=row['size']:raise HTTPException(422,'Upload size mismatch')
            image=await run_in_threadpool(s.clean_image,data)
            # A deterministic object key makes retry after an uncertain commit safe.
            path=f"{s.APP_NAME}/uploads/{user['id']}/{uid}.jpg"
            try:await s.store_image(path,image)
            except Exception:raise HTTPException(502,'Upload failed, please retry')
            await s.db.uploads.insert_one({'path':path,'user_id':user['id'],'created_at':s.now()},session=session)
            await s.db.upload_sessions.update_one({'id':uid},{'$set':{'path':path}},session=session)
            await s.db.upload_parts.delete_many({'session_id':uid},session=session)
            return {'path':path}
        return await s.db.transaction(run)

    return api

"""PostgreSQL repositories for the existing dictionary-based application services.

The small filter/update vocabulary is private to the persistence boundary. All
filters, ordering, aggregation and limits execute in PostgreSQL, never by loading
whole tables into Python. Mutations lock rows and participate in a real SQL
transaction. Business handlers retain their existing request/response dictionaries.
"""
import asyncio
import copy
import hashlib
import json
import os
import random
import re
import sys
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from enum import Enum

from sqlalchemy import select, insert, update, delete, func, and_, or_, not_, true, false, text, cast, Text, literal
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool
from schema import TABLES, SCHEMA_VERSION

# psycopg async requires a selector loop on Windows; Linux/Vercel is unaffected.
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


class DuplicateKeyError(Exception):
    pass


class ReturnDocument(Enum):
    BEFORE = 0
    AFTER = 1


@dataclass
class WriteResult:
    matched_count: int = 0
    modified_count: int = 0
    inserted_id: str | None = None
    deleted_count: int = 0


def encode(value):
    if isinstance(value, datetime):
        return {'$bgc_datetime': value.isoformat()}
    if isinstance(value, dict):
        return {k: encode(v) for k, v in value.items()}
    if isinstance(value, list):
        return [encode(v) for v in value]
    return value


def decode(value):
    if isinstance(value, dict):
        if set(value) == {'$bgc_datetime'}:
            return datetime.fromisoformat(value['$bgc_datetime'])
        return {k: decode(v) for k, v in value.items()}
    if isinstance(value, list):
        return [decode(v) for v in value]
    return value


def database_url(raw):
    if not raw:
        raise RuntimeError('DATABASE_URL is required (Neon pooled PostgreSQL URL for runtime)')
    url = make_url(raw)
    if url.drivername not in ('postgres', 'postgresql', 'postgresql+psycopg'):
        raise RuntimeError('DATABASE_URL must be a PostgreSQL URL')
    if os.environ.get('APP_ENV') == 'production' and url.query.get('sslmode') not in ('require','verify-ca','verify-full'):
        raise RuntimeError('Production DATABASE_URL requires sslmode=require or stronger')
    return url.set(drivername='postgresql+psycopg')


class Database:
    def __init__(self, url, schema='public'):
        if not re.fullmatch(r'[a-z][a-z0-9_]{0,62}', schema):
            raise ValueError('Invalid database schema name')
        self.schema = schema
        # Neon/PgBouncer owns pooling; no idle per-function connection accumulation.
        # Disable prepared statements for transaction-pooler compatibility.
        self.engine = create_async_engine(database_url(url), poolclass=NullPool,
            connect_args={'prepare_threshold': None, 'connect_timeout': 10}, hide_parameters=True)
        self.repositories = {name: Repository(self, table) for name, table in TABLES.items()}

    def __getitem__(self, name):
        return self.repositories[name]

    def __getattr__(self, name):
        if name in self.repositories:
            return self.repositories[name]
        raise AttributeError(name)

    @asynccontextmanager
    async def connection(self, session=None):
        if session is not None:
            yield session
        else:
            async with self.engine.begin() as connection:
                await self.configure(connection)
                yield connection

    async def configure(self, connection):
        # SET LOCAL is transaction-scoped and works through Neon's pooler.
        await connection.execute(text(f'SET LOCAL search_path TO "{self.schema}", public'))
        await connection.execute(text("SET LOCAL TIME ZONE 'UTC'"))
        await connection.execute(text("SET LOCAL statement_timeout = '25s'"))
        await connection.execute(text("SET LOCAL lock_timeout = '10s'"))

    async def transaction(self, callback):
        for attempt in range(6):
            try:
                async with self.connection() as connection:
                    return await callback(connection)
            except DBAPIError as exc:
                # Retry only known rolled-back transactions, never ambiguous commits.
                if getattr(exc.orig, 'sqlstate', None) not in ('40001','40P01') or attempt == 5:
                    raise
                await asyncio.sleep(random.uniform(.005, .025) * (attempt + 1))

    async def lock_user(self, user_id, session):
        row = await session.execute(select(TABLES['users'].c.id).where(TABLES['users'].c.id == user_id).with_for_update())
        return row.scalar_one_or_none() is not None

    async def check_schema(self):
        async with self.connection() as c:
            result = await c.execute(text('SELECT version FROM schema_migrations WHERE version = :version'), {'version': SCHEMA_VERSION})
            if not result.scalar_one_or_none():
                raise RuntimeError('Database schema is not current; run python scripts/migrate.py using the direct URL')

    async def ping(self):
        async with self.connection() as c:
            await c.execute(text('SELECT 1'))

    async def close(self):
        await self.engine.dispose()


class Repository:
    def __init__(self, db, table):
        self.db, self.table = db, table

    def values(self, doc):
        values = {'_key': str(doc.get('_id') or uuid.uuid4().hex), 'extra': {}}
        for key, value in doc.items():
            if key == '_id':
                continue
            if key in self.table.c and key not in ('_key','extra') and value is not None:
                values[key] = value
            else:
                # Explicit null is retained in extra; absent fields remain absent.
                values['extra'][key] = encode(value)
        return values

    def document(self, row):
        doc = decode(row['extra'])
        doc.update({k: v for k, v in row.items() if k not in ('_key','extra') and v is not None})
        doc['_id'] = row['_key']
        return doc

    def column(self, key):
        if key == '_id':
            return self.table.c._key
        if key in self.table.c and key not in ('_key','extra'):
            return self.table.c[key]
        return self.table.c.extra[key]

    def condition(self, query):
        clauses = []
        for key, value in (query or {}).items():
            if key in ('$or','$and'):
                clauses.append((or_ if key == '$or' else and_)(*[self.condition(q) for q in value]))
                continue
            if key.startswith('$'):
                raise ValueError('Unsupported persistence filter: ' + key)
            col = self.column(key)
            is_json = key not in self.table.c and key != '_id'
            def equal(v):
                if v is None:
                    return or_(col.is_(None), col == cast('null', JSONB)) if is_json else col.is_(None)
                if is_json:
                    return or_(col == literal(encode(v), type_=JSONB), col.contains(literal([encode(v)], type_=JSONB)))
                return col == v
            if not isinstance(value, dict):
                clauses.append(equal(value))
                continue
            for op, operand in value.items():
                if op == '$options':
                    continue
                if op == '$exists':
                    exists = self.table.c.extra.has_key(key) if is_json else or_(col.is_not(None), self.table.c.extra.has_key(key))
                    clauses.append(exists if operand else not_(exists))
                elif op == '$ne':
                    clauses.append(or_(col.is_(None), not_(equal(operand))) if operand is not None else col.is_not(None))
                elif op in ('$in', '$nin'):
                    test = or_(*[equal(v) for v in operand]) if operand else false()
                    clauses.append(test if op == '$in' else or_(col.is_(None), not_(test)))
                elif op in ('$gt','$gte','$lt','$lte'):
                    expr = col.astext if is_json else col
                    clauses.append({'$gt': expr.__gt__, '$gte': expr.__ge__, '$lt': expr.__lt__, '$lte': expr.__le__}[op](operand))
                elif op == '$regex':
                    expr = col.astext if is_json else col
                    clauses.append(expr.op('~*' if 'i' in value.get('$options','') else '~')(operand))
                else:
                    raise ValueError('Unsupported persistence operator: ' + op)
        return and_(*clauses) if clauses else true()

    def project(self, doc, projection):
        if not projection:
            return doc
        include = [k for k,v in projection.items() if v and k != '_id']
        if include:
            result = {k: doc[k] for k in include if k in doc}
            if projection.get('_id',1): result['_id'] = doc['_id']
            return result
        return {k:v for k,v in doc.items() if projection.get(k,1)}

    def find(self, query=None, projection=None, session=None):
        return Cursor(self, query or {}, projection, session)

    async def find_one(self, query=None, projection=None, session=None, sort=None, for_update=False):
        cursor = self.find(query, projection, session)
        cursor.for_update = for_update
        if sort: cursor.sort(sort)
        rows = await cursor.to_list(1)
        return rows[0] if rows else None

    async def count_documents(self, query, session=None):
        async with self.db.connection(session) as c:
            return (await c.execute(select(func.count()).select_from(self.table).where(self.condition(query)))).scalar_one()

    async def distinct(self, field, query=None):
        async with self.db.connection() as c:
            col = self.column(field)
            return list((await c.execute(select(col).where(self.condition(query)).distinct())).scalars())

    async def insert_one(self, doc, session=None):
        values = self.values(doc)
        try:
            async with self.db.connection(session) as c:
                await c.execute(insert(self.table).values(**values))
        except IntegrityError as exc:
            if getattr(exc.orig,'sqlstate',None) == '23505':
                raise DuplicateKeyError('Unique record already exists') from exc
            raise
        return WriteResult(inserted_id=values['_key'])

    async def insert_many(self, docs, session=None):
        async with self.db.connection(session) as c:
            for doc in docs: await self.insert_one(doc, c)

    def changed(self, doc, changes, inserting=False):
        doc = copy.deepcopy(doc)
        for operator, fields in changes.items():
            if operator not in ('$set','$unset','$inc','$push','$setOnInsert'):
                raise ValueError('Unsupported persistence update: ' + operator)
            for key,value in fields.items():
                if operator == '$set' or (operator == '$setOnInsert' and inserting): doc[key] = value
                elif operator == '$unset': doc.pop(key,None)
                elif operator == '$inc': doc[key] = doc.get(key,0) + value
                elif operator == '$push': doc.setdefault(key,[]).append(value)
        return doc

    async def mutate(self, query, changes, session, upsert, many=False):
        if upsert:
            # Existing-row locks cannot protect an absent row. A transaction-scoped
            # advisory lock serializes identical natural-key upserts across workers.
            key = self.table.name + ':' + json.dumps(encode(query),sort_keys=True)
            number = int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], 'big', signed=True)
            await session.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': number})
        stmt = select(self.table).where(self.condition(query)).order_by(self.table.c._key).with_for_update()
        if not many: stmt = stmt.limit(1)
        rows = (await session.execute(stmt)).mappings().all()
        if not rows and upsert:
            initial = {k:v for k,v in query.items() if not k.startswith('$') and not isinstance(v,dict)}
            after = self.changed(initial, changes, True)
            result = await self.insert_one(after, session)
            after['_id'] = result.inserted_id
            return WriteResult(inserted_id=result.inserted_id), None, after
        changed = 0; before = after = None
        for row in rows:
            before = self.document(row); after = self.changed(before, changes)
            if after != before:
                values = {k:None for k in self.table.c.keys() if k not in ('_key','extra')}
                values.update(self.values(after))
                await session.execute(update(self.table).where(self.table.c._key == row['_key']).values(**values))
                changed += 1
        return WriteResult(matched_count=len(rows), modified_count=changed), before, after

    async def _mutate(self, query, changes, session, upsert, many=False):
        async def run(c): return await self.mutate(query,changes,c,upsert,many)
        return await run(session) if session is not None else await self.db.transaction(run)

    async def update_one(self, query, changes, session=None, upsert=False):
        return (await self._mutate(query,changes,session,upsert))[0]

    async def update_many(self, query, changes, session=None):
        return (await self._mutate(query,changes,session,False,True))[0]

    async def find_one_and_update(self, query, changes, session=None, upsert=False, return_document=ReturnDocument.BEFORE):
        _,before,after = await self._mutate(query,changes,session,upsert)
        return after if return_document == ReturnDocument.AFTER else before

    async def delete_many(self, query, session=None):
        async with self.db.connection(session) as c:
            result = await c.execute(delete(self.table).where(self.condition(query)))
            return WriteResult(deleted_count=result.rowcount)

    def aggregate(self, pipeline, session=None):
        return AggregateCursor(self,pipeline,session)


class Cursor:
    def __init__(self, repo, query, projection, session):
        self.repo,self.query,self.projection,self.session = repo,query,projection,session
        self.order = []
        self.for_update = False

    def sort(self, key, direction=1):
        self.order = key if isinstance(key,list) else [(key,direction)]
        return self

    async def to_list(self, length=None):
        stmt = select(self.repo.table).where(self.repo.condition(self.query))
        for key,direction in self.order:
            col = self.repo.column(key)
            stmt = stmt.order_by(col.asc().nulls_first() if direction==1 else col.desc().nulls_last())
        if length is not None: stmt = stmt.limit(length)
        if self.for_update:
            if self.session is None: raise ValueError('Row locks require an explicit transaction')
            stmt = stmt.with_for_update()
        async with self.repo.db.connection(self.session) as c:
            rows = (await c.execute(stmt)).mappings().all()
        return [self.repo.project(self.repo.document(row),self.projection) for row in rows]

    def __aiter__(self):
        async def iterate():
            # Streaming pages avoid materializing entire exports in application RAM.
            stmt = select(self.repo.table).where(self.repo.condition(self.query))
            for key,direction in self.order:
                col=self.repo.column(key);stmt=stmt.order_by(col.asc() if direction==1 else col.desc())
            async with self.repo.db.connection(self.session) as c:
                async with c.stream(stmt) as rows:
                    async for row in rows.mappings():
                        yield self.repo.project(self.repo.document(row),self.projection)
        return iterate()


class AggregateCursor:
    def __init__(self, repo, pipeline, session):
        self.repo,self.pipeline,self.session = repo,pipeline,session

    async def to_list(self,length=None):
        match={};group=None
        for stage in self.pipeline:
            if '$match' in stage: match=stage['$match']
            elif '$group' in stage: group=stage['$group']
            else: raise ValueError('Unsupported aggregation stage')
        if group is None: raise ValueError('Aggregation requires group')
        columns=[];group_col=None
        if group['_id'] is not None:
            group_col=self.repo.column(group['_id'][1:]);columns.append(group_col.label('_id'))
        for label,spec in group.items():
            if label=='_id':continue
            op,value=next(iter(spec.items()))
            if op=='$sum' and value==1: expr=func.count()
            elif op=='$sum':expr=func.sum(self.repo.column(value[1:]))
            elif op=='$max':expr=func.max(self.repo.column(value[1:]))
            else:raise ValueError('Unsupported aggregate')
            columns.append(expr.label(label))
        stmt=select(*columns).select_from(self.repo.table).where(self.repo.condition(match))
        if group_col is not None:stmt=stmt.group_by(group_col)
        if length is not None:stmt=stmt.limit(length)
        async with self.repo.db.connection(self.session) as c:rows=(await c.execute(stmt)).mappings().all()
        # Mongo's empty group yields no row; SQL SUM yields NULL.
        return [{'_id':None,**dict(r)} for r in rows if any(v is not None for k,v in r.items() if k!='_id')]

    def __aiter__(self):
        async def iterate():
            for row in await self.to_list(): yield row
        return iterate()

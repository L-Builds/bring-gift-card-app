"""Apply checked-in PostgreSQL migrations with a direct (not pooled) URL.

Usage: python scripts/migrate.py
DDL never runs in a Vercel cold start. A transaction/advisory lock serializes
concurrent migration jobs. Failed migrations roll back without partial schema.
"""
import hashlib
import os
import re
import sys
from pathlib import Path
import psycopg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env')


def migrate(url, schema='public'):
    if not re.fullmatch(r'[a-z][a-z0-9_]{0,62}', schema):
        raise ValueError('Invalid schema')
    if not url:
        raise RuntimeError('DATABASE_URL_UNPOOLED is required for migrations')
    from urllib.parse import urlsplit, parse_qs
    parsed = urlsplit(url)
    if '-pooler' in (parsed.hostname or ''):
        raise RuntimeError('Use the direct Neon URL for migrations, not the -pooler URL')
    if os.environ.get('APP_ENV')=='production' and parse_qs(parsed.query).get('sslmode',[''])[0] not in ('require','verify-ca','verify-full'):
        raise RuntimeError('Production migration URL requires TLS')
    with psycopg.connect(url, prepare_threshold=None) as c:
        c.execute('SELECT pg_advisory_xact_lock(%s)', (739442005,))
        c.execute(psycopg.sql.SQL('CREATE SCHEMA IF NOT EXISTS {}').format(psycopg.sql.Identifier(schema)))
        c.execute(psycopg.sql.SQL('SET LOCAL search_path TO {}, public').format(psycopg.sql.Identifier(schema)))
        c.execute('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())')
        for file in sorted((ROOT / 'migrations').glob('*.sql')):
            body=file.read_text(encoding='utf-8');checksum=hashlib.sha256(body.encode()).hexdigest()
            previous=c.execute('SELECT checksum FROM schema_migrations WHERE version=%s',(file.stem,)).fetchone()
            if previous:
                if previous[0]!=checksum: raise RuntimeError('Applied migration checksum changed: '+file.name)
                continue
            c.execute(body,prepare=False)
            c.execute('INSERT INTO schema_migrations(version,checksum) VALUES(%s,%s)',(file.stem,checksum))
            print('Applied '+file.stem)


if __name__ == '__main__':
    migrate(os.environ.get('DATABASE_URL_UNPOOLED',''), os.environ.get('DATABASE_SCHEMA','public'))

# Bring Gift Card — Vercel + Neon

Expo Router web frontend and existing FastAPI backend, hosted as two Vercel projects; Neon PostgreSQL persistence.

Start with [VERCEL-NEON.md](VERCEL-NEON.md), [NEON-MIGRATION.md](NEON-MIGRATION.md), and [current checkpoint](../PROJECT%20BRAIN/CURRENT-CHECKPOINT.md). No redesign or live cloud deployment is included. Configure real staging credentials, storage/email and provider sandboxes before hosted acceptance.

For local backend development with Python 3.12, migrate the database and run `python run_local.py` (Windows-compatible asyncio launcher). Frontend: Node 22, `npm ci`, configure its `.env`, then `npm run web`.

"""Explicitly import website market definitions only. Never import sample rates."""
import asyncio
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import db, client, ensure_indexes


async def main():
    await ensure_indexes()
    for market in json.loads((Path(__file__).with_name("website_markets.json")).read_text(encoding="utf-8")):
        await db.markets.update_one({"code": market["code"]}, {"$setOnInsert": market}, upsert=True)
    print("Website markets installed without overwriting admin changes. No rates or accounts created.")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())

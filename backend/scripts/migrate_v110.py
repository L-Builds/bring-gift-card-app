"""Explicit upgrade of the original NGN-only database. Backup and stop writers first.

Default is read-only. --apply adds currency metadata and encrypts legacy codes.
Never recalculates, deletes or fabricates financial ledger entries or rates.
"""
import argparse
import asyncio
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server as s
from production import encrypt


async def main(apply):
    counts = {}
    for name in ("users", "trades", "withdrawals", "payout_accounts", "ledger"):
        collection = s.db[name]
        counts[name + "_missing_currency"] = await collection.count_documents({"currency": {"$exists": False}})
        if apply:
            fields = {"currency": "NGN"}
            if name != "ledger": fields["minor_digits"] = 2
            if name in ("users", "trades"): fields["market_code"] = "NG"
            await collection.update_many({"currency": {"$exists": False}}, {"$set": fields})
    counts["legacy_plaintext_codes"] = await s.db.trades.count_documents({"ecode": {"$exists": True}})
    if apply:
        async for trade in s.db.trades.find({"ecode": {"$exists": True}}):
            changes = {"$unset": {"ecode": ""}}
            if trade.get("ecode") and not trade.get("ecode_encrypted"):
                changes["$set"] = {"ecode_encrypted": encrypt(trade["ecode"])}
            await s.db.trades.update_one({"_id": trade["_id"]}, changes)
        # Existing images stay in private storage. Register only owner-scoped paths.
        for collection in (s.db.trades, s.db.support_messages):
            async for row in collection.find({"image_paths": {"$exists": True}}):
                for path in row.get("image_paths", []):
                    parts = path.split("/")
                    if len(parts) == 4 and parts[:2] == ["bring-gift-card", "uploads"]:
                        owner = parts[2]
                        if await s.db.users.find_one({"id": owner}):
                            await s.db.uploads.update_one({"path": path}, {"$setOnInsert": {"path": path, "user_id": owner, "created_at": s.now()}}, upsert=True)
        await s.ensure_indexes()
    print({"applied": apply, "counts": counts})
    s.client.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--apply", action="store_true", help="Apply only to a backed-up, offline NGN-only legacy database")
    asyncio.run(main(p.parse_args().apply))

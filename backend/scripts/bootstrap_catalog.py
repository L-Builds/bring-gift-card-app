"""Ensure the agreed Bring Gift Card catalog exists as INACTIVE records.

This helper mirrors migration 007 for local/dev environments. It never imports
sample prices, never activates cards, and never overwrites an existing card's
management settings.
"""
import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server as s

CATALOG = [
    ("Apple / iTunes", "Entertainment", "#111111", ["apple / itunes", "apple/itunes", "apple itunes", "apple", "itunes"]),
    ("Steam", "Gaming", "#1B2838", ["steam"]),
    ("Razer Gold", "Gaming", "#C89B2C", ["razer gold", "razer"]),
    ("Amazon", "Shopping", "#FF9900", ["amazon"]),
    ("Xbox", "Gaming", "#107C10", ["xbox"]),
    ("eBay", "Shopping", "#E53238", ["ebay"]),
    ("Google Play", "Entertainment", "#34A853", ["google play"]),
    ("PlayStation", "Gaming", "#006FCD", ["playstation", "play station"]),
    ("Sephora", "Beauty", "#111111", ["sephora"]),
    ("Vanilla", "Payments", "#D91F2B", ["vanilla", "vanilla visa"]),
    ("Visa", "Payments", "#1A1F71", ["visa"]),
    ("American Express", "Payments", "#006FCF", ["american express", "amex"]),
    ("Walmart", "Shopping", "#0071CE", ["walmart", "wal-mart"]),
    ("Target", "Shopping", "#CC0000", ["target"]),
    ("Nike", "Fashion", "#111111", ["nike"]),
    ("Nordstrom", "Fashion", "#111111", ["nordstrom"]),
    ("Macy's", "Shopping", "#E21D2E", ["macy's", "macys", "macy"]),
    ("Foot Locker", "Fashion", "#E31B23", ["foot locker", "footlocker"]),
    ("Best Buy", "Shopping", "#0046BE", ["best buy", "bestbuy"]),
    ("GameStop", "Gaming", "#E2231A", ["gamestop", "game stop"]),
    ("Roblox", "Gaming", "#111111", ["roblox"]),
    ("Mastercard", "Payments", "#EB001B", ["mastercard", "master card"]),
    ("Paysafecard", "Payments", "#00457C", ["paysafecard", "paysafe card"]),
    ("Netflix", "Entertainment", "#E50914", ["netflix"]),
    ("Adidas", "Fashion", "#111111", ["adidas"]),
    ("Kohl's", "Shopping", "#111111", ["kohl's", "kohls", "kohl"]),
    ("Saks", "Fashion", "#111111", ["saks", "saks fifth avenue"]),
    ("Ulta", "Beauty", "#E86A54", ["ulta", "ulta beauty"]),
    ("OffGamers", "Gaming", "#F47A20", ["offgamers", "off gamers"]),
    ("Netspend Visa", "Payments", "#D8272F", ["netspend visa", "netspend"]),
    ("One4all", "Shopping", "#D8272F", ["one4all", "one 4 all"]),
]


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


async def main():
    await s.ensure_indexes()
    existing = await s.db.brands.find({}, {"_id": 0, "id": 1, "name": 1, "slug": 1}).to_list(1000)
    names = {str(row.get("name", "")).strip().lower() for row in existing}
    slugs = {str(row.get("slug", "")).strip().lower() for row in existing}
    added = 0
    for index, (name, category, color, aliases) in enumerate(CATALOG, start=1):
        slug = slugify(name)
        if slug in slugs or any(alias.lower() in names for alias in aliases):
            continue
        model = s.BrandIn(name=name, category=category, color=color, is_active=False, is_popular=False,
                          countries=[], subcategories=[], submission_types=["physical", "ecode"])
        await s.db.brands.insert_one({**model.model_dump(), "id": f"catalog_{slug.replace('-', '_')}",
            "slug": slug, "sort_order": index, "created_at": s.now(), "catalog_seed": True})
        names.add(name.lower()); slugs.add(slug); added += 1
    print(f"Catalog ready. Added {added} inactive cards; existing management settings were left unchanged.")
    await s.db.close()


if __name__ == "__main__":
    asyncio.run(main())

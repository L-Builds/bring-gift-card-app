"""Import website brand names as INACTIVE entries; never import sample prices."""
import asyncio
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server as s

NAMES = ["Steam", "Apple", "Amazon", "Google Play", "Xbox", "PlayStation", "Netflix",
         "Spotify", "iTunes", "eBay", "Walmart", "Target", "Best Buy", "Sephora", "Nike", "Adidas", "Roblox"]


async def main():
    await s.ensure_indexes()
    for index, name in enumerate(NAMES):
        slug = name.lower().replace(" ", "-")
        if await s.db.brands.find_one({"$or": [{"slug": slug}, {"name": name}]}): continue
        model = s.BrandIn(name=name, is_active=False)
        await s.db.brands.insert_one({**model.model_dump(), "id": s.new_id(), "slug": slug,
            "sort_order": index + 1, "created_at": s.now()})
    print("Website brand names imported inactive. Review card details and configure actual denomination rates before enabling.")
    s.client.close()


if __name__ == "__main__":
    asyncio.run(main())

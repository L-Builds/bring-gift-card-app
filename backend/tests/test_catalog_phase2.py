"""Phase 2 full catalog and safe card removal checks against disposable PostgreSQL."""
import uuid

import pytest

from tests.pg_support import s, trade

pytestmark = pytest.mark.asyncio(loop_scope="session")

EXPECTED = {
    "Apple / iTunes", "Steam", "Razer Gold", "Amazon", "Xbox", "eBay", "Google Play",
    "PlayStation", "Sephora", "Vanilla", "Visa", "American Express", "Walmart", "Target",
    "Nike", "Nordstrom", "Macy's", "Foot Locker", "Best Buy", "GameStop", "Roblox",
    "Mastercard", "Paysafecard", "Netflix", "Adidas", "Kohl's", "Saks", "Ulta",
    "OffGamers", "Netspend Visa", "One4all",
}


async def test_seeded_catalog_exists_inactive_without_fake_rates(http, actors):
    rows = (await http.get("/api/admin/brands", headers=actors[3])).json()["brands"]
    names = {row["name"] for row in rows}
    # Existing deployments can already contain an alias such as Apple instead of
    # the canonical Apple / iTunes record, so migration 007 deliberately avoids
    # creating a duplicate. All other canonical seed names must be present.
    missing = EXPECTED - names
    assert missing <= {"Apple / iTunes"}, missing
    seeded = [row for row in rows if row.get("catalog_seed")]
    assert seeded
    assert all(row["is_active"] is False and row["is_popular"] is False for row in seeded)
    seeded_ids = {row["id"] for row in seeded}
    assert not await s.db.card_rates.find_one({"brand_id": {"$in": sorted(seeded_ids)}})


async def test_unused_catalog_card_can_be_permanently_deleted_with_rates(http, actors):
    admin = actors[3]
    created = await http.post("/api/admin/brands", headers=admin, json={
        "name": "Disposable Catalog Card " + uuid.uuid4().hex[:6], "is_active": False,
        "countries": [], "submission_types": ["physical", "ecode"],
    })
    assert created.status_code == 200, created.text
    brand_id = created.json()["id"]
    rate = await http.post("/api/admin/card-rates", headers=admin, json={
        "brand_id": brand_id, "market_code": "NG", "face_value": 50,
        "payout_minor": 500000, "is_active": True,
    })
    assert rate.status_code == 200, rate.text
    removed = await http.delete(f"/api/admin/brands/{brand_id}", headers=admin)
    assert removed.status_code == 200, removed.text
    assert removed.json()["deleted"] is True and removed.json()["archived"] is False
    assert await s.db.brands.find_one({"id": brand_id}) is None
    assert await s.db.card_rates.find_one({"brand_id": brand_id}) is None


async def test_catalog_card_with_trade_history_is_archived_not_destroyed(http, actors):
    created_trade, _ = await trade(http, actors)
    brand_id = created_trade["brand_id"]
    result = await http.delete(f"/api/admin/brands/{brand_id}", headers=actors[3])
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["deleted"] is False and body["archived"] is True
    stored = await s.db.brands.find_one({"id": brand_id})
    assert stored is not None
    assert stored["is_active"] is False and stored["is_popular"] is False
    assert stored.get("archived_at") is not None
    historical = await s.db.trades.find_one({"id": created_trade["id"]})
    assert historical["brand_id"] == brand_id


async def test_archived_card_can_be_intentionally_restored_by_management(http, actors):
    created_trade, _ = await trade(http, actors)
    brand_id = created_trade["brand_id"]
    assert (await http.delete(f"/api/admin/brands/{brand_id}", headers=actors[3])).status_code == 200
    archived = await s.db.brands.find_one({"id": brand_id})
    payload = {
        "name": archived["name"], "category": archived.get("category") or "Other",
        "color": archived.get("color") or "#1F5AF6", "is_active": True, "is_popular": False,
        "countries": archived.get("countries") or [], "subcategories": archived.get("subcategories") or [],
        "submission_types": archived.get("submission_types") or ["physical", "ecode"],
    }
    restored = await http.patch(f"/api/admin/brands/{brand_id}", headers=actors[3], json=payload)
    assert restored.status_code == 200, restored.text
    saved = await s.db.brands.find_one({"id": brand_id})
    assert saved["is_active"] is True
    assert saved.get("archived_at") is None

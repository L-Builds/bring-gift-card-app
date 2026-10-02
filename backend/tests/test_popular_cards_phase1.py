"""Phase 1 Popular Gift Cards controls against disposable PostgreSQL."""
import uuid

import pytest

from tests.pg_support import s

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def make_eligible(http, actors, label: str):
    admin = actors[3]
    created = await http.post("/api/admin/brands", headers=admin, json={
        "name": f"{label} {uuid.uuid4().hex[:6]}",
        "is_active": True,
        "countries": ["US"],
        "submission_types": ["physical", "ecode"],
    })
    assert created.status_code == 200, created.text
    brand_id = created.json()["id"]
    rate = await http.post("/api/admin/detailed-rates/country", headers=admin, json={
        "brand_id": brand_id,
        "market_code": "NG",
        "card_country": "US",
        "physical_rate_minor_per_unit": 100000,
    })
    assert rate.status_code == 200, rate.text
    headline = await http.post("/api/admin/headline-rates", headers=admin, json={
        "brand_id": brand_id,
        "market_code": "NG",
        "rate_minor_per_unit": 100000,
    })
    assert headline.status_code == 200, headline.text
    return brand_id


async def remove_if_popular(http, actors, brand_id: str):
    listed = (await http.get("/api/admin/popular-cards", headers=actors[3])).json()["popular_cards"]
    if brand_id in {row["brand_id"] for row in listed}:
        response = await http.delete(f"/api/admin/popular-cards/{brand_id}", headers=actors[3])
        assert response.status_code == 200, response.text


async def test_popular_bonus_uses_active_market_currency_and_keeps_headline_link(http, actors):
    brand_id = await make_eligible(http, actors, "Popular Bonus Card")
    try:
        added = await http.post("/api/admin/popular-cards", headers=actors[3], json={"brand_id": brand_id})
        assert added.status_code == 200, added.text
        body = added.json()
        assert body["brand_id"] == brand_id
        assert body["bonus_enabled"] is False
        assert len(body["headline_rates"]) == 1
        assert body["headline_rates"][0]["is_active"] is True

        updated = await http.patch(f"/api/admin/popular-cards/{brand_id}", headers=actors[3], json={
            "bonus_enabled": True,
            "bonus_market_code": "NG",
            "bonus_amount_minor": 500000,
            "min_card_value_usd": 500,
        })
        assert updated.status_code == 200, updated.text
        saved = updated.json()
        assert saved["bonus_enabled"] is True
        assert saved["bonus_market"]["currency"] == "NGN"
        assert saved["bonus_amount_minor"] == 500000
        assert saved["min_card_value_usd"] == 500
        assert saved["headline_rates"][0]["rate_minor_per_unit"] == 100000

        public = await http.get("/api/popular-cards?market_code=NG")
        assert public.status_code == 200, public.text
        home_row = next(row for row in public.json()["popular_cards"] if row["brand"]["id"] == brand_id)
        assert home_row["headline_rate"]["rate_minor_per_unit"] == 100000
        assert home_row["bonus"]["currency"] == "NGN"
        assert home_row["bonus"]["amount_minor"] == 500000
        assert home_row["bonus"]["min_card_value_usd"] == 500

        # Bonus can be turned off without creating a second/main rate field.
        off = await http.patch(f"/api/admin/popular-cards/{brand_id}", headers=actors[3], json={
            "bonus_enabled": False,
            "bonus_market_code": "NG",
            "bonus_amount_minor": 500000,
            "min_card_value_usd": 500,
        })
        assert off.status_code == 200, off.text
        assert off.json()["bonus_enabled"] is False
    finally:
        await remove_if_popular(http, actors, brand_id)
        await http.delete(f"/api/admin/brands/{brand_id}", headers=actors[3])


async def test_popular_requires_active_headline_rate(http, actors):
    created = await http.post("/api/admin/brands", headers=actors[3], json={
        "name": "No Headline " + uuid.uuid4().hex[:6],
        "is_active": True,
        "countries": ["US"],
        "submission_types": ["physical"],
    })
    assert created.status_code == 200, created.text
    brand_id = created.json()["id"]
    try:
        detailed = await http.post("/api/admin/detailed-rates/country", headers=actors[3], json={
            "brand_id": brand_id,
            "market_code": "NG",
            "card_country": "US",
            "physical_rate_minor_per_unit": 100000,
        })
        assert detailed.status_code == 200, detailed.text
        blocked = await http.post("/api/admin/popular-cards", headers=actors[3], json={"brand_id": brand_id})
        assert blocked.status_code == 409
        assert "headline" in blocked.text.lower()
    finally:
        await http.delete(f"/api/admin/brands/{brand_id}", headers=actors[3])


async def test_popular_requires_headline_and_trade_rate_in_same_market(http, actors):
    created = await http.post("/api/admin/brands", headers=actors[3], json={
        "name": "Split Market " + uuid.uuid4().hex[:6],
        "is_active": True,
        "countries": ["US"],
        "submission_types": ["physical"],
    })
    assert created.status_code == 200, created.text
    brand_id = created.json()["id"]
    try:
        detailed = await http.post("/api/admin/detailed-rates/country", headers=actors[3], json={
            "brand_id": brand_id, "market_code": "NG", "card_country": "US",
            "physical_rate_minor_per_unit": 100000,
        })
        assert detailed.status_code == 200, detailed.text
        headline = await http.post("/api/admin/headline-rates", headers=actors[3], json={
            "brand_id": brand_id, "market_code": "US", "rate_minor_per_unit": 100,
        })
        assert headline.status_code == 200, headline.text
        blocked = await http.post("/api/admin/popular-cards", headers=actors[3], json={"brand_id": brand_id})
        assert blocked.status_code == 409
        assert "same market" in blocked.text.lower()
    finally:
        await http.delete(f"/api/admin/brands/{brand_id}", headers=actors[3])


async def test_popular_order_is_admin_controlled_and_public_list_follows_it(http, actors):
    first = await make_eligible(http, actors, "Popular Order A")
    second = await make_eligible(http, actors, "Popular Order B")
    try:
        assert (await http.post("/api/admin/popular-cards", headers=actors[3], json={"brand_id": first})).status_code == 200
        assert (await http.post("/api/admin/popular-cards", headers=actors[3], json={"brand_id": second})).status_code == 200
        current = (await http.get("/api/admin/popular-cards", headers=actors[3])).json()["popular_cards"]
        ids = [row["brand_id"] for row in current]
        i1, i2 = ids.index(first), ids.index(second)
        ids[i1], ids[i2] = ids[i2], ids[i1]
        reordered = await http.post("/api/admin/popular-cards/reorder", headers=actors[3], json={"brand_ids": ids})
        assert reordered.status_code == 200, reordered.text
        admin_ids = [row["brand_id"] for row in reordered.json()["popular_cards"]]
        assert admin_ids == ids
        public = await http.get("/api/popular-cards?market_code=NG")
        assert public.status_code == 200, public.text
        public_ids = [row["brand"]["id"] for row in public.json()["popular_cards"]]
        expected_visible = [brand_id for brand_id in ids if brand_id in set(public_ids)]
        assert public_ids[:len(expected_visible)] == expected_visible
    finally:
        await remove_if_popular(http, actors, first)
        await remove_if_popular(http, actors, second)
        await http.delete(f"/api/admin/brands/{first}", headers=actors[3])
        await http.delete(f"/api/admin/brands/{second}", headers=actors[3])


async def test_popular_collection_is_capped_at_eight(http, actors):
    current = (await http.get("/api/admin/popular-cards", headers=actors[3])).json()["popular_cards"]
    needed = max(0, 8 - len(current))
    created_ids = []
    try:
        for index in range(needed):
            brand_id = await make_eligible(http, actors, f"Popular Limit {index}")
            created_ids.append(brand_id)
            added = await http.post("/api/admin/popular-cards", headers=actors[3], json={"brand_id": brand_id})
            assert added.status_code == 200, added.text
        extra = await make_eligible(http, actors, "Popular Limit Extra")
        created_ids.append(extra)
        blocked = await http.post("/api/admin/popular-cards", headers=actors[3], json={"brand_id": extra})
        assert blocked.status_code == 409
        assert "at most 8" in blocked.text
    finally:
        for brand_id in created_ids:
            await remove_if_popular(http, actors, brand_id)
            await http.delete(f"/api/admin/brands/{brand_id}", headers=actors[3])

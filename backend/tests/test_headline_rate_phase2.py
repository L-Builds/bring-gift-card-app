"""Phase 2 independent Admin All Cards headline-rate control."""
import uuid

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_admin_headline_rate_is_one_upserted_value_per_card_market(http, actors):
    admin = actors[3]
    created = await http.post("/api/admin/brands", headers=admin, json={
        "name": "Headline Phase2 " + uuid.uuid4().hex[:6],
        "is_active": True,
        "countries": ["US"],
        "submission_types": ["physical", "ecode"],
    })
    assert created.status_code == 200, created.text
    brand_id = created.json()["id"]
    try:
        first = await http.post("/api/admin/headline-rates", headers=admin, json={
            "brand_id": brand_id,
            "market_code": "NG",
            "rate_minor_per_unit": 113841,
        })
        assert first.status_code == 200, first.text
        first_row = first.json()
        assert first_row["rate_minor_per_unit"] == 113841
        assert first_row["version"] == 1
        assert first_row["is_active"] is True

        second = await http.post("/api/admin/headline-rates", headers=admin, json={
            "brand_id": brand_id,
            "market_code": "NG",
            "rate_minor_per_unit": 110934,
        })
        assert second.status_code == 200, second.text
        second_row = second.json()
        assert second_row["id"] == first_row["id"]
        assert second_row["rate_minor_per_unit"] == 110934
        assert second_row["version"] == 2

        listed = await http.get(f"/api/admin/headline-rates?brand_id={brand_id}", headers=admin)
        assert listed.status_code == 200, listed.text
        rows = [row for row in listed.json()["headline_rates"] if row["market_code"] == "NG"]
        assert len(rows) == 1
        assert rows[0]["rate_minor_per_unit"] == 110934
    finally:
        await http.delete(f"/api/admin/brands/{brand_id}", headers=admin)


async def test_popular_home_uses_independent_headline_rate_not_legacy_headline_flag(http, actors):
    admin = actors[3]
    created = await http.post("/api/admin/brands", headers=admin, json={
        "name": "Popular Headline Phase2 " + uuid.uuid4().hex[:6],
        "is_active": True,
        "countries": ["US"],
        "submission_types": ["physical"],
    })
    assert created.status_code == 200, created.text
    brand_id = created.json()["id"]
    try:
        # Configure one current detailed rate so the card is tradable. The main
        # Popular price still comes only from the independent headline record.
        detailed = await http.post("/api/admin/detailed-rates/country", headers=admin, json={
            "brand_id": brand_id,
            "market_code": "NG",
            "card_country": "US",
            "physical_rate_minor_per_unit": 90000,
        })
        assert detailed.status_code == 200, detailed.text

        headline = await http.post("/api/admin/headline-rates", headers=admin, json={
            "brand_id": brand_id,
            "market_code": "NG",
            "rate_minor_per_unit": 113841,
        })
        assert headline.status_code == 200, headline.text

        added = await http.post("/api/admin/popular-cards", headers=admin, json={"brand_id": brand_id})
        assert added.status_code == 200, added.text
        assert added.json()["headline_rates"][0]["rate_minor_per_unit"] == 113841

        public = await http.get("/api/popular-cards?market_code=NG")
        assert public.status_code == 200, public.text
        row = next(item for item in public.json()["popular_cards"] if item["brand"]["id"] == brand_id)
        assert row["headline_rate"]["rate_minor_per_unit"] == 113841
        assert row["headline_rate"].get("face_value") is None
        assert row["headline_rate"].get("payout_minor") is None
    finally:
        listed = (await http.get("/api/admin/popular-cards", headers=admin)).json()["popular_cards"]
        if brand_id in {row["brand_id"] for row in listed}:
            await http.delete(f"/api/admin/popular-cards/{brand_id}", headers=admin)
        await http.delete(f"/api/admin/brands/{brand_id}", headers=admin)

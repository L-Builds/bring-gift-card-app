"""Phase 4 customer All Cards headline-rate source checks."""
import uuid

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_public_headline_rates_expose_independent_rate_per_unit(http, actors):
    admin = actors[3]
    created = await http.post("/api/admin/brands", headers=admin, json={
        "name": "All Cards Phase4 " + uuid.uuid4().hex[:6],
        "is_active": True,
        "countries": ["US"],
        "submission_types": ["physical"],
    })
    assert created.status_code == 200, created.text
    brand_id = created.json()["id"]
    try:
        # Phase 6 keeps All Cards discovery/display independent from legacy
        # denomination rows; the headline record alone is the display source.
        headline = await http.post("/api/admin/headline-rates", headers=admin, json={
            "brand_id": brand_id,
            "market_code": "NG",
            "rate_minor_per_unit": 113841,
        })
        assert headline.status_code == 200, headline.text

        public = await http.get("/api/headline-rates?market_code=NG")
        assert public.status_code == 200, public.text
        body = public.json()
        assert body["market"]["currency"] == "NGN"
        row = next(item for item in body["headline_rates"] if item["brand_id"] == brand_id)
        assert row["rate_minor_per_unit"] == 113841
        assert row.get("face_value") is None
        assert row.get("payout_minor") is None
        assert row.get("is_headline") is None
    finally:
        await http.delete(f"/api/admin/brands/{brand_id}", headers=admin)

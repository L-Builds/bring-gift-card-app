"""Phase 5 public Individual Gift Card Rates page/API checks."""
import uuid

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_public_detailed_rates_only_expose_active_configured_country_types(http, actors):
    admin = actors[3]
    created = await http.post("/api/admin/brands", headers=admin, json={
        "name": "Customer Detailed Phase5 " + uuid.uuid4().hex[:6],
        "is_active": True,
        "countries": [],
        "submission_types": ["physical", "ecode"],
    })
    assert created.status_code == 200, created.text
    brand_id = created.json()["id"]
    try:
        saved_us = await http.post("/api/admin/detailed-rates/country", headers=admin, json={
            "brand_id": brand_id,
            "market_code": "NG",
            "card_country": "US",
            "physical_rate_minor_per_unit": 113841,
            "code_rate_minor_per_unit": 110500,
        })
        assert saved_us.status_code == 200, saved_us.text

        saved_ca = await http.post("/api/admin/detailed-rates/country", headers=admin, json={
            "brand_id": brand_id,
            "market_code": "NG",
            "card_country": "CA",
            "physical_rate_minor_per_unit": 72640,
        })
        assert saved_ca.status_code == 200, saved_ca.text

        public = await http.get(f"/api/detailed-rates?brand_id={brand_id}&market_code=NG")
        assert public.status_code == 200, public.text
        rows = public.json()["detailed_rates"]
        assert {(row["card_country"], row["submission_type"], row["rate_minor_per_unit"]) for row in rows} == {
            ("US", "physical", 113841),
            ("US", "ecode", 110500),
            ("CA", "physical", 72640),
        }
        assert all(row["is_active"] is True for row in rows)
        assert all("face_value" not in row for row in rows)
        assert all("range_min" not in row for row in rows)
        assert all("range_max" not in row for row in rows)
        assert all("payout_minor" not in row for row in rows)

        disabled = await http.post(f"/api/admin/detailed-rates/{brand_id}/NG/CA/disable", headers=admin)
        assert disabled.status_code == 200, disabled.text
        rows = (await http.get(f"/api/detailed-rates?brand_id={brand_id}&market_code=NG")).json()["detailed_rates"]
        assert {row["card_country"] for row in rows} == {"US"}
    finally:
        await http.delete(f"/api/admin/brands/{brand_id}", headers=admin)

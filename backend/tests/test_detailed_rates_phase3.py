"""Phase 3 admin Detailed Card Rates workspace and API."""
import uuid

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_admin_detailed_rates_are_card_country_type_per_unit_only(http, actors):
    admin = actors[3]
    created = await http.post("/api/admin/brands", headers=admin, json={
        "name": "Detailed Phase3 " + uuid.uuid4().hex[:6],
        "is_active": True,
        "countries": [],
        "submission_types": ["physical", "ecode"],
    })
    assert created.status_code == 200, created.text
    brand_id = created.json()["id"]
    try:
        initial = await http.get(f"/api/admin/detailed-rates?brand_id={brand_id}", headers=admin)
        assert initial.status_code == 200, initial.text
        assert initial.json()["detailed_rates"] == []

        saved_us = await http.post("/api/admin/detailed-rates/country", headers=admin, json={
            "brand_id": brand_id,
            "market_code": "NG",
            "card_country": "us",
            "physical_rate_minor_per_unit": 113841,
            "code_rate_minor_per_unit": 110500,
        })
        assert saved_us.status_code == 200, saved_us.text
        assert saved_us.json()["card_country"] == "US"
        assert {row["submission_type"] for row in saved_us.json()["rates"]} == {"physical", "ecode"}
        for row in saved_us.json()["rates"]:
            assert row["card_country"] == "US"
            assert row["market_code"] == "NG"
            assert row["is_active"] is True
            assert "face_value" not in row
            assert "range_min" not in row
            assert "range_max" not in row
            assert "payout_minor" not in row

        saved_ca = await http.post("/api/admin/detailed-rates/country", headers=admin, json={
            "brand_id": brand_id,
            "market_code": "NG",
            "card_country": "CA",
            "physical_rate_minor_per_unit": 72640,
        })
        assert saved_ca.status_code == 200, saved_ca.text

        listed = await http.get(f"/api/admin/detailed-rates?brand_id={brand_id}", headers=admin)
        assert listed.status_code == 200, listed.text
        rows = listed.json()["detailed_rates"]
        assert {row["card_country"] for row in rows} == {"US", "CA"}
        assert all(row["market_code"] == "NG" for row in rows)

        # Phase 3 must not create or mutate legacy denomination rows. Phase 6
        # retains those rows only for historical/admin compatibility.
        legacy = await http.get(f"/api/admin/card-rates?brand_id={brand_id}", headers=admin)
        assert legacy.status_code == 200, legacy.text
        assert legacy.json()["rates"] == []

        disabled = await http.post(
            f"/api/admin/detailed-rates/{brand_id}/NG/US/disable", headers=admin
        )
        assert disabled.status_code == 200, disabled.text
        assert disabled.json()["is_active"] is False
        rows = (await http.get(f"/api/admin/detailed-rates?brand_id={brand_id}", headers=admin)).json()["detailed_rates"]
        assert all(not row["is_active"] for row in rows if row["card_country"] == "US")

        enabled = await http.post(
            f"/api/admin/detailed-rates/{brand_id}/NG/US/enable", headers=admin
        )
        assert enabled.status_code == 200, enabled.text
        rows = (await http.get(f"/api/admin/detailed-rates?brand_id={brand_id}", headers=admin)).json()["detailed_rates"]
        assert all(row["is_active"] for row in rows if row["card_country"] == "US")

        removed = await http.delete(f"/api/admin/detailed-rates/{brand_id}/NG/CA", headers=admin)
        assert removed.status_code == 200, removed.text
        rows = (await http.get(f"/api/admin/detailed-rates?brand_id={brand_id}", headers=admin)).json()["detailed_rates"]
        assert {row["card_country"] for row in rows} == {"US"}
    finally:
        await http.delete(f"/api/admin/brands/{brand_id}", headers=admin)


async def test_detailed_rates_reject_submission_type_not_enabled_for_card(http, actors):
    admin = actors[3]
    created = await http.post("/api/admin/brands", headers=admin, json={
        "name": "Physical Only Phase3 " + uuid.uuid4().hex[:6],
        "is_active": True,
        "countries": [],
        "submission_types": ["physical"],
    })
    assert created.status_code == 200, created.text
    brand_id = created.json()["id"]
    try:
        denied = await http.post("/api/admin/detailed-rates/country", headers=admin, json={
            "brand_id": brand_id,
            "market_code": "NG",
            "card_country": "US",
            "code_rate_minor_per_unit": 100000,
        })
        assert denied.status_code == 409, denied.text
    finally:
        await http.delete(f"/api/admin/brands/{brand_id}", headers=admin)

"""Phase 6 end-to-end rate chain against disposable PostgreSQL.

This test intentionally spans the already-approved Phase 1-5 rate surfaces plus the
Phase 6 trade cutover. It does not seed sample business rates outside the test schema.
"""
import uuid

import pytest

from tests.pg_support import s

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_phase6_rate_chain_and_trade_cutover(http, actors):
    customer_auth = actors[2]
    admin_auth = actors[3]
    name = "Phase6 E2E " + uuid.uuid4().hex[:8]
    created = await http.post("/api/admin/brands", headers=admin_auth, json={
        "name": name,
        "is_active": True,
        "countries": [],
        "submission_types": ["physical", "ecode"],
    })
    assert created.status_code == 200, created.text
    brand_id = created.json()["id"]

    try:
        # A legacy denomination row may still exist for history/admin purposes, but
        # it must never become the live Phase 6 quote source.
        legacy = await http.post("/api/admin/card-rates", headers=admin_auth, json={
            "brand_id": brand_id,
            "market_code": "NG",
            "card_country": "US",
            "face_value": 100,
            "submission_type": "ecode",
            "rate_minor_per_usd": 999999,
        })
        assert legacy.status_code == 200, legacy.text

        headline = await http.post("/api/admin/headline-rates", headers=admin_auth, json={
            "brand_id": brand_id,
            "market_code": "NG",
            "rate_minor_per_unit": 113841,
        })
        assert headline.status_code == 200, headline.text

        detailed = await http.post("/api/admin/detailed-rates/country", headers=admin_auth, json={
            "brand_id": brand_id,
            "market_code": "NG",
            "card_country": "US",
            "physical_rate_minor_per_unit": 113841,
            "code_rate_minor_per_unit": 110500,
        })
        assert detailed.status_code == 200, detailed.text
        code_rate = next(row for row in detailed.json()["rates"] if row["submission_type"] == "ecode")

        popular = await http.post("/api/admin/popular-cards", headers=admin_auth, json={"brand_id": brand_id})
        assert popular.status_code == 200, popular.text

        # All Cards discovery follows the independent headline rate while Trade
        # discovery follows current detailed rates.
        rate_brands = await http.get("/api/brands?market_code=NG&purpose=rates")
        assert rate_brands.status_code == 200, rate_brands.text
        assert brand_id in {row["id"] for row in rate_brands.json()["brands"]}
        trade_brands = await http.get("/api/brands?market_code=NG")
        assert trade_brands.status_code == 200, trade_brands.text
        assert brand_id in {row["id"] for row in trade_brands.json()["brands"]}

        home = await http.get("/api/popular-cards?market_code=NG")
        assert home.status_code == 200, home.text
        popular_row = next(row for row in home.json()["popular_cards"] if row["brand"]["id"] == brand_id)
        assert popular_row["headline_rate"]["rate_minor_per_unit"] == 113841

        public_detail = await http.get(f"/api/detailed-rates?brand_id={brand_id}&market_code=NG")
        assert public_detail.status_code == 200, public_detail.text
        assert {(row["card_country"], row["submission_type"], row["rate_minor_per_unit"])
                for row in public_detail.json()["detailed_rates"]} == {
                    ("US", "physical", 113841), ("US", "ecode", 110500),
                }

        too_large = await http.post("/api/quotes", headers=customer_auth, json={
            "brand_id": brand_id, "face_value": 10**18, "quantity": 100,
            "card_country": "US", "submission_type": "ecode",
        })
        assert too_large.status_code == 422, too_large.text

        quote = await http.post("/api/quotes", headers=customer_auth, json={
            "brand_id": brand_id,
            "face_value": 100,
            "quantity": 2,
            "card_country": "US",
            "submission_type": "ecode",
        })
        assert quote.status_code == 200, quote.text
        first_quote = quote.json()
        assert first_quote["rate_id"] == code_rate["id"]
        assert first_quote["rate_minor_per_unit"] == 110500
        assert first_quote["payout_minor"] == 100 * 110500 * 2
        assert first_quote["rate_id"] != legacy.json()["id"]

        # Publishing a new detailed rate invalidates a stale quote version.
        updated = await http.post("/api/admin/detailed-rates/country", headers=admin_auth, json={
            "brand_id": brand_id,
            "market_code": "NG",
            "card_country": "US",
            "physical_rate_minor_per_unit": 113841,
            "code_rate_minor_per_unit": 111000,
        })
        assert updated.status_code == 200, updated.text

        stale = await http.post("/api/trades", headers=customer_auth, json={
            "brand_id": brand_id,
            "rate_version": first_quote["rate_version"],
            "submission_type": "ecode",
            "country": "US",
            "card_value_usd": 100,
            "quantity": 2,
            "ecode": "PHASE6-STALE-PRIVATE-CODE",
        })
        assert stale.status_code == 409, stale.text

        fresh_quote = await http.post("/api/quotes", headers=customer_auth, json={
            "brand_id": brand_id,
            "face_value": 100,
            "quantity": 2,
            "card_country": "US",
            "submission_type": "ecode",
        })
        assert fresh_quote.status_code == 200, fresh_quote.text
        fresh = fresh_quote.json()
        assert fresh["rate_minor_per_unit"] == 111000
        assert fresh["payout_minor"] == 100 * 111000 * 2

        trade = await http.post("/api/trades", headers=customer_auth, json={
            "brand_id": brand_id,
            "rate_version": fresh["rate_version"],
            "submission_type": "ecode",
            "country": "US",
            "card_value_usd": 100,
            "quantity": 2,
            "ecode": "PHASE6-FRESH-PRIVATE-CODE",
        })
        assert trade.status_code == 200, trade.text
        saved_trade = trade.json()
        assert saved_trade["expected_payout_kobo"] == 100 * 111000 * 2
        assert saved_trade["rate_minor_per_unit"] == 111000
        assert saved_trade["rate_id"] == fresh["rate_id"]

        # Removing the configured country archives current detailed pricing and
        # removes Trade availability, while headline discovery and historical trade
        # snapshots remain intact.
        removed = await http.delete(f"/api/admin/detailed-rates/{brand_id}/NG/US", headers=admin_auth)
        assert removed.status_code == 200, removed.text
        after_remove_trade = await http.get("/api/brands?market_code=NG")
        assert brand_id not in {row["id"] for row in after_remove_trade.json()["brands"]}
        after_remove_rates = await http.get("/api/brands?market_code=NG&purpose=rates")
        assert brand_id in {row["id"] for row in after_remove_rates.json()["brands"]}
        assert await s.db.trades.find_one({"id": saved_trade["id"]}) is not None
        assert await s.db.card_rates.find_one({"id": legacy.json()["id"]}) is not None
    finally:
        popular_rows = (await http.get("/api/admin/popular-cards", headers=admin_auth)).json()["popular_cards"]
        if brand_id in {row["brand_id"] for row in popular_rows}:
            await http.delete(f"/api/admin/popular-cards/{brand_id}", headers=admin_auth)
        await http.delete(f"/api/admin/brands/{brand_id}", headers=admin_auth)

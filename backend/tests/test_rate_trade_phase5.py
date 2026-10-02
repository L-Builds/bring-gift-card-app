"""Phase 6 cutover checks kept in the prior integration-test location for continuity."""
import uuid
import pytest
from tests.pg_support import s

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def create_brand(http, actors):
    response = await http.post("/api/admin/brands", headers=actors[3], json={
        "name": "Phase 6 Card " + uuid.uuid4().hex[:6],
        "is_active": True,
        "countries": [],
        "submission_types": ["physical", "ecode"],
    })
    assert response.status_code == 200, response.text
    return response.json()["id"]


async def test_headline_rate_is_admin_selected_and_unique_per_card_market(http, actors):
    brand_id = await create_brand(http, actors)
    first = await http.post("/api/admin/headline-rates", headers=actors[3], json={
        "brand_id": brand_id, "market_code": "NG", "rate_minor_per_unit": 101065,
    })
    second = await http.post("/api/admin/headline-rates", headers=actors[3], json={
        "brand_id": brand_id, "market_code": "NG", "rate_minor_per_unit": 107739,
    })
    assert first.status_code == second.status_code == 200, (first.text, second.text)
    listed = (await http.get(f"/api/admin/headline-rates?brand_id={brand_id}", headers=actors[3])).json()["headline_rates"]
    assert len([r for r in listed if r["market_code"] == "NG"]) == 1
    assert next(r for r in listed if r["market_code"] == "NG")["rate_minor_per_unit"] == 107739


async def test_quote_and_trade_use_same_detailed_country_type_rate_per_unit(http, actors):
    brand_id = await create_brand(http, actors)
    configured = await http.post("/api/admin/detailed-rates/country", headers=actors[3], json={
        "brand_id": brand_id, "market_code": "NG", "card_country": "US",
        "physical_rate_minor_per_unit": 113841, "code_rate_minor_per_unit": 110500,
    })
    assert configured.status_code == 200, configured.text
    code_rate = next(row for row in configured.json()["rates"] if row["submission_type"] == "ecode")

    quote = await http.post("/api/quotes", headers=actors[2], json={
        "brand_id": brand_id, "face_value": 50, "quantity": 2,
        "card_country": "US", "submission_type": "ecode",
    })
    assert quote.status_code == 200, quote.text
    payload = quote.json()
    assert payload["rate_id"] == code_rate["id"]
    assert payload["rate_minor_per_unit"] == 110500
    assert payload["payout_minor"] == 110500 * 50 * 2
    assert payload["range_min"] is None and payload["range_max"] is None

    wrong_type = await http.post("/api/quotes", headers=actors[2], json={
        "brand_id": brand_id, "face_value": 50, "quantity": 1,
        "card_country": "CA", "submission_type": "ecode",
    })
    assert wrong_type.status_code == 409

    trade = await http.post("/api/trades", headers=actors[2], json={
        "brand_id": brand_id,
        "rate_version": payload["rate_version"],
        "submission_type": "ecode",
        "country": "US",
        "card_value_usd": 50,
        "quantity": 2,
        "ecode": "PHASE6-PRIVATE-CODE",
    })
    assert trade.status_code == 200, trade.text
    created = trade.json()
    assert created["rate_id"] == code_rate["id"]
    assert created["expected_payout_kobo"] == 110500 * 50 * 2
    assert created["rate_minor_per_unit"] == 110500


async def test_legacy_denomination_rows_remain_but_do_not_price_new_trades(http, actors):
    brand_id = await create_brand(http, actors)
    legacy = await http.post("/api/admin/card-rates", headers=actors[3], json={
        "brand_id": brand_id, "market_code": "NG", "card_country": "US", "face_value": 25,
        "submission_type": "ecode", "rate_minor_per_usd": 999999,
    })
    assert legacy.status_code == 200, legacy.text

    no_detail_quote = await http.post("/api/quotes", headers=actors[2], json={
        "brand_id": brand_id, "face_value": 25, "quantity": 1,
        "card_country": "US", "submission_type": "ecode",
    })
    assert no_detail_quote.status_code == 409
    assert await s.db.card_rates.find_one({"id": legacy.json()["id"]}) is not None

    configured = await http.post("/api/admin/detailed-rates/country", headers=actors[3], json={
        "brand_id": brand_id, "market_code": "NG", "card_country": "US",
        "code_rate_minor_per_unit": 100000,
    })
    assert configured.status_code == 200, configured.text
    quote = await http.post("/api/quotes", headers=actors[2], json={
        "brand_id": brand_id, "face_value": 25, "quantity": 1,
        "card_country": "US", "submission_type": "ecode",
    })
    assert quote.status_code == 200, quote.text
    assert quote.json()["rate_minor_per_unit"] == 100000
    assert quote.json()["rate_id"] != legacy.json()["id"]

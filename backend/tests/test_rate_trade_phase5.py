"""Phase 5 database-backed headline-rate and exact-trade integration checks."""
import uuid
import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def create_brand(http, actors):
    response = await http.post("/api/admin/brands", headers=actors[3], json={
        "name": "Phase 5 Card " + uuid.uuid4().hex[:6],
        "is_active": True,
        "countries": ["US"],
        "submission_types": ["physical", "ecode"],
    })
    assert response.status_code == 200, response.text
    return response.json()["id"]


async def test_headline_rate_is_admin_selected_and_unique_per_card_market(http, actors):
    brand_id = await create_brand(http, actors)
    first_body = {
        "brand_id": brand_id, "market_code": "NG", "card_country": "US",
        "face_value": 50, "submission_type": "ecode", "range_min": 100, "range_max": 300,
        "rate_minor_per_usd": 101065, "is_active": True, "is_headline": True,
    }
    second_body = {
        "brand_id": brand_id, "market_code": "NG", "card_country": "US",
        "face_value": 100, "submission_type": "physical", "range_min": 300, "range_max": 500,
        "rate_minor_per_usd": 107739, "is_active": True, "is_headline": True,
    }
    first = await http.post("/api/admin/card-rates", headers=actors[3], json=first_body)
    second = await http.post("/api/admin/card-rates", headers=actors[3], json=second_body)
    assert first.status_code == second.status_code == 200, (first.text, second.text)
    listed = (await http.get(f"/api/admin/card-rates?brand_id={brand_id}", headers=actors[3])).json()["rates"]
    headlines = [r for r in listed if r.get("is_headline")]
    assert len(headlines) == 1
    assert headlines[0]["id"] == second.json()["id"]


async def test_quote_and_trade_use_same_exact_typed_ranged_rule(http, actors):
    brand_id = await create_brand(http, actors)
    rate = await http.post("/api/admin/card-rates", headers=actors[3], json={
        "brand_id": brand_id, "market_code": "NG", "card_country": "US",
        "face_value": 50, "submission_type": "ecode", "range_min": 100, "range_max": 500,
        "rate_minor_per_usd": 101065, "is_active": True, "is_headline": True,
    })
    assert rate.status_code == 200, rate.text

    quote = await http.post("/api/quotes", headers=actors[2], json={
        "brand_id": brand_id, "face_value": 50, "quantity": 2,
        "card_country": "US", "submission_type": "ecode",
    })
    assert quote.status_code == 200, quote.text
    payload = quote.json()
    assert payload["rate_id"] == rate.json()["id"]
    assert payload["rate_minor_per_usd"] == 101065
    assert payload["payout_minor"] == 101065 * 50 * 2

    outside = await http.post("/api/quotes", headers=actors[2], json={
        "brand_id": brand_id, "face_value": 50, "quantity": 1,
        "card_country": "US", "submission_type": "ecode",
    })
    assert outside.status_code == 409

    trade = await http.post("/api/trades", headers=actors[2], json={
        "brand_id": brand_id,
        "rate_version": payload["rate_version"],
        "submission_type": "ecode",
        "country": "US",
        "card_value_usd": 50,
        "quantity": 2,
        "ecode": "PHASE5-PRIVATE-CODE",
    })
    assert trade.status_code == 200, trade.text
    created = trade.json()
    assert created["rate_id"] == rate.json()["id"]
    assert created["expected_payout_kobo"] == 101065 * 50 * 2

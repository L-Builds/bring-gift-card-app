"""Phase 1 rate-rule foundation tests against disposable PostgreSQL."""
import uuid

import pytest

from tests.pg_support import s, trade

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _brand(http, actors, name="Rule Foundation Card"):
    response = await http.post("/api/admin/brands", headers=actors[3], json={"name": name, "is_active": True})
    assert response.status_code == 200, response.text
    return response.json()["id"]


async def test_typed_ranged_rules_can_share_brand_market_and_face_value(http, actors):
    brand_id = await _brand(http, actors, "Typed Rule Card " + uuid.uuid4().hex[:6])
    physical = {
        "brand_id": brand_id,
        "market_code": "NG",
        "face_value": 50,
        "submission_type": "physical",
        "range_min": 400,
        "range_max": 500,
        "rate_minor_per_usd": 115176,
        "is_active": True,
    }
    code = {
        "brand_id": brand_id,
        "market_code": "NG",
        "face_value": 50,
        "submission_type": "ecode",
        "range_min": 100,
        "range_max": 500,
        "rate_minor_per_usd": 101065,
        "is_active": True,
    }
    first = await http.post("/api/admin/card-rates", headers=actors[3], json=physical)
    second = await http.post("/api/admin/card-rates", headers=actors[3], json=code)
    assert first.status_code == second.status_code == 200, (first.text, second.text)
    assert first.json()["id"] != second.json()["id"]
    assert first.json()["payout_minor"] == 50 * 115176
    assert second.json()["payout_minor"] == 50 * 101065

    listed = (await http.get(f"/api/admin/card-rates?brand_id={brand_id}", headers=actors[3])).json()["rates"]
    assert len(listed) == 2
    assert {(row["submission_type"], row["range_min"], row["range_max"]) for row in listed} == {
        ("physical", 400, 500), ("ecode", 100, 500)
    }


async def test_edit_disable_and_safe_delete_unused_rule(http, actors):
    brand_id = await _brand(http, actors, "Editable Rule Card " + uuid.uuid4().hex[:6])
    body = {
        "brand_id": brand_id,
        "market_code": "NG",
        "face_value": 20,
        "submission_type": "ecode",
        "rate_minor_per_usd": 104879,
        "is_active": True,
    }
    created = await http.post("/api/admin/card-rates", headers=actors[3], json=body)
    assert created.status_code == 200, created.text
    rate_id = created.json()["id"]

    changed = {**body, "range_min": 0, "range_max": 20, "rate_minor_per_usd": 108883}
    edited = await http.patch(f"/api/admin/card-rates/{rate_id}", headers=actors[3], json=changed)
    assert edited.status_code == 200, edited.text
    assert edited.json()["id"] == rate_id
    assert edited.json()["range_min"] == 0 and edited.json()["range_max"] == 20
    assert edited.json()["version"] == created.json()["version"] + 1

    disabled = await http.post(f"/api/admin/card-rates/{rate_id}/disable", headers=actors[3])
    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["rate"]["is_active"] is False

    deleted = await http.delete(f"/api/admin/card-rates/{rate_id}/safe", headers=actors[3])
    assert deleted.status_code == 200, deleted.text
    assert deleted.json() == {"ok": True, "deleted": True, "archived": False}
    assert await s.db.card_rates.find_one({"id": rate_id}) is None


async def test_safe_delete_archives_rate_used_by_historical_trade(http, actors):
    created_trade, _ = await trade(http, actors)
    rate_id = created_trade["rate_id"]
    result = await http.delete(f"/api/admin/card-rates/{rate_id}/safe", headers=actors[3])
    assert result.status_code == 200, result.text
    payload = result.json()
    assert payload["deleted"] is False and payload["archived"] is True
    stored = await s.db.card_rates.find_one({"id": rate_id})
    assert stored is not None
    assert stored["is_active"] is False
    assert stored.get("archived_at") is not None
    historical = await s.db.trades.find_one({"id": created_trade["id"]})
    assert historical["rate_id"] == rate_id


async def test_legacy_quote_does_not_accidentally_use_typed_or_ranged_rule(http, actors):
    brand_id = await _brand(http, actors, "Protected Legacy Quote " + uuid.uuid4().hex[:6])
    advanced = await http.post("/api/admin/card-rates", headers=actors[3], json={
        "brand_id": brand_id,
        "market_code": "NG",
        "face_value": 100,
        "submission_type": "physical",
        "range_min": 300,
        "range_max": 500,
        "rate_minor_per_usd": 110000,
    })
    assert advanced.status_code == 200, advanced.text
    quote = await http.post("/api/quotes", headers=actors[2], json={"brand_id": brand_id, "face_value": 100, "quantity": 1})
    assert quote.status_code == 409
    assert "No active rate" in quote.text


async def test_rate_rule_validation_rejects_partial_or_inconsistent_ranges(http, actors):
    brand_id = await _brand(http, actors, "Invalid Rule Card " + uuid.uuid4().hex[:6])
    base = {"brand_id": brand_id, "market_code": "NG", "face_value": 50, "rate_minor_per_usd": 100000}
    partial = await http.post("/api/admin/card-rates", headers=actors[3], json={**base, "range_min": 100})
    backwards = await http.post("/api/admin/card-rates", headers=actors[3], json={**base, "range_min": 500, "range_max": 100})
    inconsistent = await http.post("/api/admin/card-rates", headers=actors[3], json={**base, "payout_minor": 1})
    assert partial.status_code == backwards.status_code == inconsistent.status_code == 422

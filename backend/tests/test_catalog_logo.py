"""Catalog publication and managed-logo checks against disposable PostgreSQL."""
import io

import pytest
from PIL import Image

from tests.pg_support import s

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_public_catalog_only_lists_tradable_cards(http, actors):
    admin = actors[3]
    created = await http.post("/api/admin/brands", headers=admin,
        json={"name": "Catalog Readiness Card", "is_active": True, "is_popular": True})
    assert created.status_code == 200, created.text
    brand_id = created.json()["id"]
    assert created.json()["is_tradable"] is False
    assert brand_id not in {b["id"] for b in (await http.get("/api/brands?market_code=NG")).json()["brands"]}

    rate = await http.post("/api/admin/card-rates", headers=admin,
        json={"brand_id": brand_id, "market_code": "NG", "face_value": 100, "payout_minor": 120000})
    assert rate.status_code == 200, rate.text
    listed = (await http.get("/api/brands?market_code=NG&popular=true")).json()["brands"]
    assert any(b["id"] == brand_id and b["is_tradable"] for b in listed)
    assert (await http.get(f"/api/brands/{brand_id}?market_code=IN")).status_code == 404
    settings = {"name": "Catalog Readiness Card", "is_active": True, "is_popular": False}
    assert (await http.patch(f"/api/admin/brands/{brand_id}", headers=admin, json=settings)).status_code == 200
    assert brand_id not in {b["id"] for b in (await http.get("/api/brands?market_code=NG&popular=true")).json()["brands"]}
    assert brand_id in {b["id"] for b in (await http.get("/api/brands?market_code=NG")).json()["brands"]}
    settings["is_active"] = False
    assert (await http.patch(f"/api/admin/brands/{brand_id}", headers=admin, json=settings)).status_code == 200
    assert brand_id not in {b["id"] for b in (await http.get("/api/brands?market_code=NG")).json()["brands"]}
    settings["is_active"] = True
    assert (await http.patch(f"/api/admin/brands/{brand_id}", headers=admin, json=settings)).status_code == 200
    assert (await http.delete(f'/api/admin/card-rates/{rate.json()["id"]}', headers=admin)).status_code == 200
    assert brand_id not in {b["id"] for b in (await http.get("/api/brands?market_code=NG")).json()["brands"]}
    admin_list = (await http.get("/api/admin/brands", headers=admin)).json()["brands"]
    entry = next(b for b in admin_list if b["id"] == brand_id)
    assert entry["is_active"] is True and entry["is_tradable"] is False


async def test_logo_normalized_and_served_without_exposing_private_upload(http, actors, monkeypatch):
    monkeypatch.delenv("S3_BUCKET", raising=False)
    admin, customer = actors[3], actors[2]
    brand = await http.post("/api/admin/brands", headers=admin,
        json={"name": "Managed Logo Card", "is_active": False})
    assert brand.status_code == 200, brand.text
    brand_id = brand.json()["id"]
    source = io.BytesIO()
    Image.new("RGBA", (1200, 600), (45, 80, 150, 180)).save(source, format="PNG")
    original = source.getvalue()
    saved: dict[str, bytes] = {}
    monkeypatch.setattr(s, "_get_object", lambda path: (saved[path], "image/png"))
    monkeypatch.setattr(s, "_put_object", lambda path, data, content_type: saved.update({path: data}))

    begin_body = {"size": len(original), "purpose": "brand_logo", "brand_id": brand_id}
    assert (await http.post("/api/uploads/chunks", headers=customer, json=begin_body)).status_code == 403
    begin = await http.post("/api/uploads/chunks", headers=admin, json=begin_body)
    assert begin.status_code == 200, begin.text
    session_id = begin.json()["id"]
    chunk_size = begin.json()["chunk_size"]
    for part, offset in enumerate(range(0, len(original), chunk_size)):
        chunk = await http.put(f"/api/uploads/chunks/{session_id}/{part}", headers=admin,
            content=original[offset:offset + chunk_size])
        assert chunk.status_code == 200, chunk.text
    complete = await http.post(f"/api/uploads/chunks/{session_id}/complete", headers=admin)
    assert complete.status_code == 200, complete.text
    changed = next(b for b in (await http.get("/api/admin/brands", headers=admin)).json()["brands"]
                   if b["id"] == brand_id)
    assert changed["has_logo"] and changed["logo_version"]
    assert "logo_path" not in changed
    logo = await http.get(f"/api/brands/{brand_id}/logo")
    assert logo.status_code == 200 and logo.headers["content-type"].startswith("image/png")
    with Image.open(io.BytesIO(logo.content)) as normalized:
        assert normalized.size == (512, 512)
        assert normalized.getpixel((0, 0))[3] == 0
    assert (await http.get(f"/api/brands/{brand_id}/logo",
        headers={"If-None-Match": logo.headers["etag"]})).status_code == 304
    removed = await http.delete(f"/api/admin/brands/{brand_id}/logo", headers=admin)
    assert removed.status_code == 200 and removed.json()["has_logo"] is False
    assert (await http.get(f"/api/brands/{brand_id}/logo")).status_code == 404

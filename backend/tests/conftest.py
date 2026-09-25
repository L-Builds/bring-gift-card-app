import os
import uuid
import pytest
import requests

BASE = (os.environ.get("BGC_TEST_API_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = f"{BASE}/api"


@pytest.fixture(scope="session")
def api_base():
    return API


@pytest.fixture(scope="session")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(http, email, password):
    r = http.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_token(http):
    email = os.environ.get("BGC_TEST_ADMIN_EMAIL", "").strip()
    password = os.environ.get("BGC_TEST_ADMIN_PASSWORD", "")
    if not email or not password:
        pytest.skip("Set BGC_TEST_ADMIN_EMAIL and BGC_TEST_ADMIN_PASSWORD for admin integration tests")
    return _login(http, email, password)


@pytest.fixture(scope="session")
def new_customer(http):
    suffix = uuid.uuid4().hex[:10]
    email = f"TEST_{suffix}@example.com"
    phone = f"+23480{int(suffix[:7], 16) % 100000000:08d}"
    r = http.post(f"{API}/auth/signup", json={
        "full_name": "Test User", "email": email, "phone": phone,
        "password": "TestPass!234", "country": "Nigeria"
    }, timeout=30)
    assert r.status_code == 200, r.text
    return {"email": email, "password": "TestPass!234", "token": r.json()["access_token"], "user": r.json()["user"]}


def auth(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}

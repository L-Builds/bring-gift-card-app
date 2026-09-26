"""Bring Gift Card — FastAPI backend.

V1: gift-card trading. Honest financial state via an append-only ledger,
idempotent money mutations, admin review workflow, and configurable company / Paystack / Flutterwave payout adapters.
"""

import os
import re
import sys
import hmac
import json
from decimal import Decimal
import uuid
import hashlib
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

import jwt
import httpx
import requests
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, UploadFile, File, Query, Request
from fastapi.responses import Response, JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from passlib.context import CryptContext
from pymongo.errors import DuplicateKeyError
from pymongo import ReturnDocument
from money import Money
from production import Production, encrypt, decrypt, ManualPaidIn
from payout_providers import ProviderError
from private_services import clean_image, put_private, get_private, send_reset
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
APP_ENV = os.environ.get("APP_ENV", "development").strip().lower()
IS_PRODUCTION = APP_ENV == "production"

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
if len(JWT_SECRET) < 32:
    raise RuntimeError("JWT_SECRET must be at least 32 characters")
if IS_PRODUCTION and JWT_SECRET.lower().startswith(("replace", "change-me", "changeme")):
    raise RuntimeError("Production JWT_SECRET must be a real secret, not an example placeholder")

JWT_ALG = "HS256"
JWT_DAYS = 7

OBJECT_STORAGE_KEY = (os.environ.get("OBJECT_STORAGE_INTEGRATION_KEY") or os.environ.get("EMERGENT_LLM_KEY") or "").strip()
STORAGE_BASE = (
    os.environ.get("OBJECT_STORAGE_BASE_URL")
    or os.environ.get("INTEGRATION_PROXY_URL")
    or ""
).strip()
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage" if STORAGE_BASE else ""
GOOGLE_AUTH_SESSION_URL = os.environ.get("GOOGLE_AUTH_SESSION_URL", "").strip()
EXPOSE_DEV_RESET_TOKEN = (
    not IS_PRODUCTION
    and os.environ.get("EXPOSE_DEV_RESET_TOKEN", "false").strip().lower() in {"1", "true", "yes"}
)
APP_NAME = "bring-gift-card"


def _parse_origins(raw: str) -> list[str]:
    return [x.strip().rstrip("/") for x in raw.split(",") if x.strip()]


CORS_ORIGINS = _parse_origins(os.environ.get("CORS_ORIGINS", ""))
if IS_PRODUCTION and (not CORS_ORIGINS or "*" in CORS_ORIGINS):
    raise RuntimeError("Production requires explicit CORS_ORIGINS; wildcard CORS is not allowed")
if not CORS_ORIGINS:
    CORS_ORIGINS = ["*"]  # development only

# KYC document options for the current manual review UI. Final provider/policy remains company-defined.
KYC_ID_TYPES = {
    "nin": "National ID (NIN)",
    "drivers_license": "Driver's License",
    "passport": "International Passport",
    "voters_card": "Voter's Card",
}


pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer = HTTPBearer(auto_error=False)

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Bring Gift Card API", docs_url=None if IS_PRODUCTION else "/docs", redoc_url=None if IS_PRODUCTION else "/redoc")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("bgc")


def now() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return uuid.uuid4().hex


def hash_pw(p: str) -> str:
    return pwd.hash(p)


def verify_pw(p: str, h: str) -> bool:
    try:
        return pwd.verify(p, h)
    except Exception:
        return False


def make_token(user: dict) -> str:
    claims = {
        "sub": user["id"],
        "role": user["role"],
        "ver": user.get("token_version", 0),
        "iat": now(),
        "exp": now() + timedelta(days=JWT_DAYS),
    }
    return jwt.encode(claims, JWT_SECRET, algorithm=JWT_ALG)


def order_ref(prefix: str) -> str:
    return prefix + uuid.uuid4().hex[:8].upper()


# ---------------------------------------------------------------------------
# Object storage helpers (managed integration)
# ---------------------------------------------------------------------------
_storage_key: Optional[str] = None


def _init_storage() -> str:
    global _storage_key
    if _storage_key:
        return _storage_key
    if not STORAGE_URL or not OBJECT_STORAGE_KEY:
        raise RuntimeError("Object storage is not configured")
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": OBJECT_STORAGE_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def _put_object(path: str, data: bytes, content_type: str) -> dict:
    global _storage_key
    key = _init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    if resp.status_code == 503:
        _storage_key = None
        key = _init_storage()
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
    resp.raise_for_status()
    return resp.json()


def _get_object(path: str) -> tuple[bytes, str]:
    key = _init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# ---------------------------------------------------------------------------
# Auth dependencies
# ---------------------------------------------------------------------------
async def _user_from_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.InvalidTokenError:
        return None
    user = await db.users.find_one({"id": payload.get("sub"), "disabled": {"$ne": True}}, {"_id": 0, "password_hash": 0})
    if user and payload.get("ver", 0) != user.get("token_version", 0):
        return None
    return user


async def current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> dict:
    if not creds:
        raise HTTPException(401, "Not authenticated")
    user = await _user_from_token(creds.credentials)
    if not user:
        raise HTTPException(401, "Invalid or expired session")
    return user


async def require_admin(user: dict = Depends(current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(403, "Admins only")
    return user


# ---------------------------------------------------------------------------
# Ledger / balance
# ---------------------------------------------------------------------------
async def balance_kobo(user_id: str) -> int:
    cur = db.ledger.aggregate([
        {"$match": {"user_id": user_id}},
        {"$group": {"_id": None, "total": {"$sum": "$amount_kobo"}}},
    ])
    docs = await cur.to_list(1)
    return int(docs[0]["total"]) if docs else 0


async def notify(user_id: str, title: str, body: str, ntype: str, ref_id: str = "") -> None:
    await db.notifications.insert_one({
        "id": new_id(), "user_id": user_id, "title": title, "body": body,
        "type": ntype, "ref_id": ref_id, "read": False, "created_at": now(),
    })


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class SignupIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    phone: str = Field(min_length=6, max_length=30)
    password: str = Field(min_length=10, max_length=72)
    country: str = "Nigeria"
    market_code: str = "NG"
    accepted_terms: bool = False
    referral_code: str = ""


class ReferralApplyIn(BaseModel):
    code: str = Field(min_length=3, max_length=20)



class LoginIn(BaseModel):
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(default=None, min_length=6, max_length=30)
    password: str


class SessionIn(BaseModel):
    session_id: str = Field(min_length=1)


class KycIn(BaseModel):
    id_type: Literal["nin", "drivers_license", "passport", "voters_card"]
    id_number: str = Field(min_length=4, max_length=40)
    full_name: str = Field(min_length=2, max_length=120)
    dob: str = Field(min_length=4, max_length=20)
    address: str = Field(min_length=4, max_length=240)
    id_front_path: str = Field(min_length=1)
    id_back_path: str = ""
    selfie_path: str = Field(min_length=1)


class ResetReqIn(BaseModel):
    email: EmailStr


class ResetConfirmIn(BaseModel):
    token: str
    password: str = Field(min_length=10, max_length=72)


class TradeIn(BaseModel):
    brand_id: str
    submission_type: Literal["physical", "ecode"]
    subcategory: str = ""
    country: str = ""
    rate_version: int = Field(ge=1)
    card_value_usd: int = Field(gt=0, le=1000000)
    quantity: int = Field(default=1, ge=1, le=100)
    notes: str = Field(default="", max_length=3000)
    ecode: str = Field(default="", max_length=10000)
    image_paths: List[str] = Field(default_factory=list, max_length=12)


class NeedInfoReplyIn(BaseModel):
    message: str
    ecode: str = Field(default="", max_length=10000)
    image_paths: List[str] = Field(default_factory=list, max_length=12)


class PayoutAccountIn(BaseModel):
    provider_name: str = Field(min_length=2, max_length=100)
    account_number: str = Field(min_length=4, max_length=40)
    account_name: str = Field(min_length=2, max_length=120)
    bank_code: str = Field(default="", max_length=30)
    payout_provider_id: str = "manual"
    kind: Literal["bank", "wallet"] = "bank"


class WithdrawIn(BaseModel):
    amount_kobo: int = Field(gt=0, le=9000000000000)
    payout_account_id: str
    narration: str = ""
    pin: str = ""


class PinSetIn(BaseModel):
    pin: str = Field(min_length=4, max_length=4, pattern=r"^\d{4}$")
    current_pin: str = ""


class PinResetIn(BaseModel):
    password: str
    pin: str = Field(min_length=4, max_length=4, pattern=r"^\d{4}$")


class TicketIn(BaseModel):
    subject: str = Field(min_length=3, max_length=120)
    category: Literal["trade", "withdrawal", "account", "kyc", "other"] = "other"
    message: str = Field(min_length=3, max_length=3000)
    ref_type: Literal["", "trade", "withdrawal"] = ""
    ref_id: str = ""
    image_paths: List[str] = Field(default_factory=list, max_length=12)


class TicketMessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=3000)
    image_paths: List[str] = Field(default_factory=list, max_length=12)


class TicketStatusIn(BaseModel):
    status: Literal["OPEN", "AWAITING_CUSTOMER", "RESOLVED", "CLOSED"]


class AdminApproveIn(BaseModel):
    approved_amount_kobo: Optional[int] = Field(default=None, gt=0, le=9000000000000)
    note: str = ""


class AdminReasonIn(BaseModel):
    reason: str = Field(min_length=1, max_length=3000)


class BrandIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    category: str = "Other"
    color: str = Field(default="#1F5AF6", pattern=r"^#[0-9a-fA-F]{6}$")
    rate_kobo_per_usd: int = Field(default=0, ge=0) # legacy only; use denomination rates
    is_active: bool = True
    is_popular: bool = False
    submission_types: List[Literal["physical", "ecode"]] = Field(default=["physical", "ecode"], min_length=1,max_length=2)
    subcategories: List[str] = []
    countries: List[str] = []


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------
def public_user(u: dict) -> dict:
    return {
        "id": u["id"], "full_name": u["full_name"], "email": u["email"],
        "phone": u.get("phone", ""), "role": u.get("role", "customer"),
        "currency": u.get("currency", "NGN"), "minor_digits": u.get("minor_digits", 2), "market_code": u.get("market_code", "NG"),
        "country": u.get("country", "Nigeria"), "kyc_status": u.get("kyc_status", "unverified"),
        "notifications_enabled": u.get("notifications_enabled", True),
        "auth_provider": u.get("auth_provider", "password"), "picture": u.get("picture", ""),
        "has_pin": bool(u.get("pin_hash")),
    }


PIN_MAX_ATTEMPTS = 5
PIN_LOCK_MINUTES = 15


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def verify_pin_or_raise(user: dict, pin: str) -> None:
    """Serialize account PIN attempts so concurrent guesses cannot bypass lockout."""
    async def check(session):
        await money.lock_user(user["id"], session)
        full = await db.users.find_one({"id": user["id"]}, session=session)
        if not full.get("pin_hash"):
            return (403, "PIN_REQUIRED", "Set a 4-digit transaction PIN before withdrawing.")
        locked = _aware(full.get("pin_locked_until"))
        if locked and locked > now():
            return (423, "PIN_LOCKED", "Your transaction PIN is temporarily locked. Try again later.")
        if not pin or not pin.isdigit() or len(pin) != 4:
            return (400, "PIN_INVALID", "Enter your 4-digit transaction PIN.")
        if not verify_pw(pin, full["pin_hash"]):
            failed = (0 if locked else int(full.get("pin_failed", 0))) + 1
            changes = {"pin_failed": failed, "pin_locked_until": None}
            if failed >= PIN_MAX_ATTEMPTS:
                changes.update(pin_failed=0, pin_locked_until=now() + timedelta(minutes=PIN_LOCK_MINUTES))
            await db.users.update_one({"id": user["id"]}, {"$set": changes}, session=session)
            return (423, "PIN_LOCKED", "Too many incorrect attempts. Try again later.") if failed >= PIN_MAX_ATTEMPTS else (401, "PIN_WRONG", "Incorrect transaction PIN.")
        await db.users.update_one({"id": user["id"]}, {"$set": {"pin_failed": 0, "pin_locked_until": None}}, session=session)
        return None
    failure = await money.transaction(check)
    if failure:
        raise HTTPException(failure[0], {"code": failure[1], "message": failure[2]})


def public_trade(t: dict) -> dict:
    t = dict(t)
    t.pop("_id", None)
    # mask ecode
    if t.get("ecode"):
        e = t["ecode"]
        t["ecode_masked"] = ("•" * max(0, len(e) - 4)) + e[-4:] if len(e) > 4 else "••••"
    t.pop("ecode", None)
    t.pop("ecode_encrypted", None)
    t.pop("admin_note", None)
    return t



async def validate_uploads(paths, user):
    for path in paths:
        if not await db.uploads.find_one({"path": path, "user_id": user["id"]}):
            raise HTTPException(403, "Attachment does not belong to this account")


@app.middleware("http")
async def security_boundary(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/kyc") or path.startswith("/api/admin/kyc"):
        return JSONResponse({"detail": "KYC is deferred in v1.1.0"}, status_code=404)
    if request.method == "POST" and (path.startswith("/api/auth/") or path.startswith("/api/security/")):
        # Shared DB counter works across API workers; never trust client forwarded headers here.
        ip = request.client.host if request.client else "unknown"
        bucket = int(now().timestamp()) // 60
        key = hashlib.sha256((ip + path + str(bucket)).encode()).hexdigest()
        row = await db.abuse_counters.find_one_and_update({"_id": key},
            {"$inc": {"count": 1}, "$setOnInsert": {"expires_at": now() + timedelta(minutes=2)}},
            upsert=True, return_document=ReturnDocument.AFTER)
        if row["count"] > 20:
            return JSONResponse({"detail": "Too many attempts. Try again shortly."}, status_code=429, headers={"Retry-After": "60"})
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    return response

# ===========================================================================
# AUTH ROUTES
# ===========================================================================
@api.post("/auth/signup")
async def signup(x: SignupIn):
    if len(x.password.encode()) > 72:
        raise HTTPException(422, "Password must fit within 72 UTF-8 bytes")
    market = await db.markets.find_one({"code": x.market_code, "is_active": True})
    if not market:
        raise HTTPException(422, "Select an available country")
    if not x.accepted_terms:
        raise HTTPException(422, "Accept the Terms and Privacy Policy to register")
    if IS_PRODUCTION and await db.legal.count_documents({"id": {"$in": ["terms", "privacy"]}}) != 2:
        raise HTTPException(503, "Registration opens after company legal documents are published")
    email = str(x.email).strip().lower()
    phone = x.phone.strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email already registered")
    if await db.users.find_one({"phone": phone}):
        raise HTTPException(409, "Phone number already registered")
    referrer = None
    if x.referral_code.strip():
        referrer = await db.users.find_one({"referral_code": x.referral_code.strip().upper(), "disabled": {"$ne": True}}, {"_id": 0, "id": 1})
        if not referrer:
            raise HTTPException(400, "Referral code not found")
    user = {
        "id": new_id(), "full_name": x.full_name.strip(), "email": email,
        "phone": phone, "password_hash": hash_pw(x.password),
        "role": "customer", "country": market["name"], "market_code": market["code"], "currency": market["currency"], "minor_digits": market["minor_digits"], "terms_accepted_at": now(), "kyc_status": "unverified",
        "notifications_enabled": True, "disabled": False,
        "referral_code": "BGC" + uuid.uuid4().hex[:6].upper(), "created_at": now(),
        "referred_by": referrer["id"] if referrer else None,
    }
    try:
        await db.users.insert_one(user)
    except DuplicateKeyError:
        raise HTTPException(409, "Account already registered")
    return {"access_token": make_token(user), "user": public_user(user)}


@api.post("/auth/login")
async def login(x: LoginIn):
    if x.email is not None:
        identity = {"email": str(x.email).strip().lower()}
        error_message = "Incorrect email or password"
    elif x.phone is not None and x.phone.strip():
        identity = {"phone": x.phone.strip()}
        error_message = "Incorrect phone number or password"
    else:
        raise HTTPException(422, "Email or phone number is required")
    user = await db.users.find_one(identity)
    if not user or not verify_pw(x.password, user.get("password_hash", "")) or user.get("disabled"):
        raise HTTPException(401, error_message)
    return {"access_token": make_token(user), "user": public_user(user)}


@api.get("/auth/me")
async def me(user: dict = Depends(current_user)):
    return {"user": public_user(user), "balance_kobo": await balance_kobo(user["id"])}


@api.post("/auth/session")
async def google_session(x: SessionIn):
    """Exchange a one-time managed-auth `session_id` for an app JWT (upsert user by email)."""
    if not GOOGLE_AUTH_SESSION_URL:
        raise HTTPException(503, "Google sign-in is not configured")
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.get(GOOGLE_AUTH_SESSION_URL, headers={"X-Session-ID": x.session_id})
    except httpx.HTTPError:
        raise HTTPException(401, "Google sign-in could not be verified. Please try again.")
    if r.status_code != 200:
        raise HTTPException(401, "Google sign-in session is invalid or expired. Please try again.")
    data = r.json()
    email = str(data.get("email", "")).strip().lower()
    if not email:
        raise HTTPException(401, "Google account has no email address")
    user = await db.users.find_one({"email": email})
    if user and user.get("disabled"):
        raise HTTPException(401, "This account is disabled")
    if not user:
        raise HTTPException(409, "Create an account with your country and legal acceptance before linking Google")
    else:
        upd = {"last_login_at": now()}
        if data.get("picture") and not user.get("picture"):
            upd["picture"] = data["picture"]
        if not user.get("auth_provider"):
            upd["auth_provider"] = "google" if not user.get("password_hash") else "password"
        await db.users.update_one({"id": user["id"]}, {"$set": upd})
        user = {**user, **upd}
    token = make_token(user)
    return {"session_token": token, "access_token": token, "user": public_user(user)}


@api.post("/auth/password-reset/request")
async def reset_request(x: ResetReqIn):
    if not os.environ.get("SMTP_HOST") and not EXPOSE_DEV_RESET_TOKEN:
        raise HTTPException(503, "Password recovery delivery is not configured. Contact support.")
    user = await db.users.find_one({"email": str(x.email).strip().lower()})
    token = ""
    if user:
        token = uuid.uuid4().hex
        await db.password_resets.insert_one({
            "id": new_id(), "user_id": user["id"], "token_hash": hashlib.sha256(token.encode()).hexdigest(),
            "expires_at": now() + timedelta(minutes=30), "used": False, "created_at": now(),
        })
    if token and os.environ.get("SMTP_HOST"):
        try:
            await run_in_threadpool(send_reset, user["email"], token)
        except Exception:
            logger.error("Password reset email delivery failed")
            raise HTTPException(503, "Recovery delivery is temporarily unavailable")
    # Development token exposure is opt-in. A reset token may be exposed only when explicitly enabled
    # in a non-production environment; production never returns reset tokens.
    body = {"message": "If the account exists, reset instructions were sent."}
    if EXPOSE_DEV_RESET_TOKEN and token:
        body["dev_token"] = token
    return body


@api.post("/auth/password-reset/confirm")
async def reset_confirm(x: ResetConfirmIn):
    if len(x.password.encode()) > 72:
        raise HTTPException(422, "Password is too long in UTF-8 bytes")
    th = hashlib.sha256(x.token.encode()).hexdigest()
    hashed = hash_pw(x.password)
    async def run(session):
        doc = await db.password_resets.find_one_and_update(
            {"token_hash": th, "used": False, "expires_at": {"$gt": now()}},
            {"$set": {"used": True}}, session=session)
        if not doc:
            raise HTTPException(400, "Invalid or expired reset token")
        await db.users.update_one({"id": doc["user_id"]}, {"$set": {"password_hash": hashed},
            "$inc": {"token_version": 1}}, session=session)
    await money.transaction(run)
    return {"message": "Password updated. Please log in."}


# ===========================================================================
# CATALOG / RATES  (public rates are read-only for guests)
# ===========================================================================
@api.get("/brands")
async def list_brands(popular: bool = False, category: str = "", q: str = ""):
    query: dict = {"is_active": True}
    if popular:
        query["is_popular"] = True
    if category and category.lower() != "all":
        query["category"] = category
    if q:
        query["name"] = {"$regex": re.escape(q), "$options": "i"}
    cur = db.brands.find(query, {"_id": 0}).sort("sort_order", 1)
    return {"brands": await cur.to_list(200)}


@api.get("/brands/{brand_id}")
async def get_brand(brand_id: str):
    b = await db.brands.find_one({"id": brand_id, "is_active": True}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Card not found")
    return b


@api.get("/categories")
async def categories():
    cats = await db.brands.distinct("category", {"is_active": True})
    return {"categories": ["All"] + sorted(cats)}


# ===========================================================================
# UPLOADS  (private; owner/admin read only)
# ===========================================================================
@api.post("/uploads")
async def upload_file(user: dict = Depends(current_user), file: UploadFile = File(...)):
    ext = (file.filename or "img.jpg").split(".")[-1].lower()[:5] or "jpg"
    data = await file.read(12 * 1024 * 1024 + 1)
    if len(data) > 12 * 1024 * 1024:
        raise HTTPException(413, "Image too large (max 12MB)")
    data = await run_in_threadpool(clean_image, data)
    path = f"{APP_NAME}/uploads/{user['id']}/{new_id()}.jpg"
    try:
        if os.environ.get("S3_BUCKET"):
            await run_in_threadpool(put_private, path, data)
        else:
            await run_in_threadpool(_put_object, path, data, "image/jpeg")
    except Exception as e:
        logger.exception("upload failed")
        raise HTTPException(502, "Upload failed, please retry")
    await db.uploads.insert_one({"path": path, "user_id": user["id"], "created_at": now()})
    return {"path": path}


@api.get("/files/{path:path}")
async def get_file(path: str, creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)):
    jwt_token = creds.credentials if creds else ""
    user = await _user_from_token(jwt_token) if jwt_token else None
    if not user:
        raise HTTPException(401, "Not authenticated")
    if ".." in path or not re.fullmatch(r"bring-gift-card/uploads/[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+", path):
        raise HTTPException(400, "Invalid file path")
    owner_prefix = f"{APP_NAME}/uploads/{user['id']}/"
    if user.get("role") != "admin" and not path.startswith(owner_prefix):
        # An admin may attach evidence to a support reply. Only that ticket's
        # customer can read it; this does not grant access to other admin files.
        allowed = False
        async for msg in db.support_messages.find({"image_paths": path, "sender": "admin"}, {"ticket_id": 1}):
            if await db.support_tickets.find_one({"id": msg["ticket_id"], "user_id": user["id"]}):
                allowed = True
                break
        if not allowed:
            raise HTTPException(403, "Not allowed")
    try:
        content, ctype = await run_in_threadpool(get_private if os.environ.get("S3_BUCKET") else _get_object, path)
    except Exception:
        raise HTTPException(404, "File not found")
    return Response(content=content, media_type=ctype, headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


# ===========================================================================
# TRADES
# ===========================================================================
@api.post("/trades")
async def create_trade(x: TradeIn, user: dict = Depends(current_user)):
    brand = await db.brands.find_one({"id": x.brand_id, "is_active": True}, {"_id": 0})
    if not brand:
        raise HTTPException(404, "Card not available")
    submission_types = brand.get("submission_types") or ["physical", "ecode"]
    if x.submission_type not in submission_types:
        raise HTTPException(400, "That submission type is not available for this card")
    subcategories = brand.get("subcategories") or []
    if subcategories and x.subcategory not in subcategories:
        raise HTTPException(400, "Selected card type / sub-category is not available")
    countries = brand.get("countries") or []
    if countries and x.country not in countries:
        raise HTTPException(400, "Selected country / region is not available for this card")
    if x.submission_type == "physical" and not x.image_paths:
        raise HTTPException(400, "Please upload at least one clear image of the card")
    if x.submission_type == "ecode" and not x.ecode.strip():
        raise HTTPException(400, "Please enter the e-code / card details")
    await validate_uploads(x.image_paths, user)
    quote = await production.quote(x.brand_id, x.card_value_usd, x.quantity, user)
    if quote["rate_version"] != x.rate_version:
        raise HTTPException(409, "Rate changed. Refresh the quote and review before submitting.")
    payout = quote["payout_minor"]
    rate = quote["unit_payout_minor"] // x.card_value_usd
    ts = now()
    trade = {
        "id": new_id(), "order_id": order_ref("BGC"), "user_id": user["id"],
        "brand_id": brand["id"], "brand_name": brand["name"], "brand_color": brand.get("color", "#1F5AF6"),
        "category": brand.get("category", ""), "submission_type": x.submission_type,
        "subcategory": x.subcategory, "country": x.country,
        "card_value_usd": x.card_value_usd, "quantity": x.quantity,
        "rate_kobo_per_usd": rate, "expected_payout_kobo": payout,
        "approved_payout_kobo": None, "status": "PENDING_REVIEW",
        "image_paths": x.image_paths, "ecode_encrypted": encrypt(x.ecode.strip()), "notes": x.notes,
        **quote,
        "reason": "", "credited": False,
        "status_history": [{"status": "PENDING_REVIEW", "at": ts, "by": "customer", "note": "Submitted for review"}],
        "created_at": ts, "updated_at": ts,
    }
    await db.trades.insert_one(trade)
    await notify(user["id"], "Trade submitted",
                 f"Your {brand['name']} trade {trade['order_id']} is pending review.", "trade", trade["id"])
    return public_trade(trade)


@api.get("/trades")
async def my_trades(status: str = "", user: dict = Depends(current_user)):
    query: dict = {"user_id": user["id"]}
    if status:
        query["status"] = status
    cur = db.trades.find(query, {"_id": 0}).sort("created_at", -1)
    return {"trades": [public_trade(t) for t in await cur.to_list(200)]}


@api.get("/trades/{trade_id}")
async def get_trade(trade_id: str, user: dict = Depends(current_user)):
    t = await db.trades.find_one({"id": trade_id, "user_id": user["id"]})
    if not t:
        raise HTTPException(404, "Trade not found")
    return public_trade(t)


@api.post("/trades/{trade_id}/reply")
async def reply_need_info(trade_id: str, x: NeedInfoReplyIn, user: dict = Depends(current_user)):
    t = await db.trades.find_one({"id": trade_id, "user_id": user["id"]})
    if not t:
        raise HTTPException(404, "Trade not found")
    if t["status"] != "NEED_MORE_INFO":
        raise HTTPException(400, "This trade is not awaiting more information")
    await validate_uploads(x.image_paths, user)
    updates = {"status": "PENDING_REVIEW", "updated_at": now()}
    if x.ecode.strip():
        updates["ecode_encrypted"] = encrypt(x.ecode.strip())
    new_images = t.get("image_paths", []) + x.image_paths
    if x.image_paths:
        updates["image_paths"] = new_images
    hist = {"status": "PENDING_REVIEW", "at": now(), "by": "customer", "note": x.message or "Customer provided more information"}
    result = await db.trades.update_one({"id": trade_id, "status": "NEED_MORE_INFO"}, {"$set": updates, "$push": {"status_history": hist}})
    if not result.modified_count:
        raise HTTPException(409, "Trade state changed; refresh before replying")
    t = await db.trades.find_one({"id": trade_id})
    return public_trade(t)


# ===========================================================================
# WALLET
# ===========================================================================
@api.get("/wallet")
async def wallet(user: dict = Depends(current_user)):
    bal = await balance_kobo(user["id"])
    accounts_count = await db.payout_accounts.count_documents({"user_id": user["id"], "deleted_at": None})
    return {"available_balance_kobo": bal, "currency": user.get("currency", "NGN"), "payout_accounts_count": accounts_count}


# ===========================================================================
# PAYOUT ACCOUNTS
# ===========================================================================
@api.get("/payout-accounts")
async def list_accounts(user: dict = Depends(current_user)):
    cur = db.payout_accounts.find({"user_id": user["id"], "deleted_at": None}, {"_id": 0}).sort("created_at", -1)
    return {"accounts": await cur.to_list(100)}


@api.post("/payout-accounts")
async def add_account(x: PayoutAccountIn, user: dict = Depends(current_user)):
    resolved_name = x.account_name.strip()
    verified = False
    if x.payout_provider_id != "manual":
        _, adapter = await production.provider(x.payout_provider_id, enabled=True)
        if user.get("currency", "NGN") not in adapter.currencies or not x.bank_code:
            raise HTTPException(400, "Unsupported currency or missing bank code")
        try:
            result = await adapter.resolve(x.bank_code, x.account_number.strip())
        except ProviderError as exc:
            raise HTTPException(502, str(exc))
        resolved_name = result.get("account_name", "").strip()
        if not resolved_name or result.get("account_number") != x.account_number.strip():
            raise HTTPException(400, "Account could not be verified")
        verified = True
    acc = {
        "id": new_id(), "user_id": user["id"], "kind": x.kind,
        "provider_name": x.provider_name.strip(), "account_number": x.account_number.strip(),
        "account_name": resolved_name, "verified": verified, "bank_code": x.bank_code,
        "payout_provider_id": x.payout_provider_id, "currency": user.get("currency", "NGN"), "deleted_at": None, "created_at": now(),
    }
    await db.payout_accounts.insert_one(acc)
    acc.pop("_id", None)
    return acc


@api.delete("/payout-accounts/{account_id}")
async def delete_account(account_id: str, user: dict = Depends(current_user)):
    res = await db.payout_accounts.update_one(
        {"id": account_id, "user_id": user["id"], "deleted_at": None}, {"$set": {"deleted_at": now()}})
    if res.matched_count == 0:
        raise HTTPException(404, "Account not found")
    return {"ok": True}


# ===========================================================================
# WITHDRAWALS
# ===========================================================================
@api.post("/withdrawals")
async def create_withdrawal(x: WithdrawIn, user: dict = Depends(current_user), idempotency_key: str = Header(...)):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{16,100}", idempotency_key):
        raise HTTPException(422, "A valid Idempotency-Key is required")
    return await money.withdraw(x, user, idempotency_key)


@api.get("/withdrawals")
async def my_withdrawals(user: dict = Depends(current_user)):
    cur = db.withdrawals.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1)
    return {"withdrawals": await cur.to_list(100)}


# ===========================================================================
# TRANSACTIONS (unified customer history)
# ===========================================================================
def _trade_status_label(s: str) -> str:
    return {"APPROVED": "Completed", "PENDING_REVIEW": "Pending", "NEED_MORE_INFO": "Pending",
            "REJECTED": "Failed", "DRAFT": "Pending"}.get(s, "Pending")


def _wd_status_label(s: str) -> str:
    return {"PAID": "Completed", "PENDING": "Pending", "PROCESSING": "Pending",
            "REJECTED": "Failed", "CANCELLED": "Failed", "REVERSED": "Refunded"}.get(s, "Pending")


@api.get("/transactions")
async def transactions(type: str = "all", status: str = "", user: dict = Depends(current_user)):
    items: list[dict] = []
    if type in ("all", "sales"):
        for t in await db.trades.find({"user_id": user["id"]}, {"_id": 0}).to_list(300):
            amt = t.get("approved_payout_kobo") or t.get("expected_payout_kobo") or 0
            items.append({
                "currency": t.get("currency", "NGN"), "id": t["id"], "kind": "sale", "title": t["brand_name"],
                "subtitle": f"${t['card_value_usd']} {'E-code' if t['submission_type']=='ecode' else 'Gift Card'}",
                "amount_kobo": amt, "signed": 1, "status": _trade_status_label(t["status"]),
                "ref": t["order_id"], "color": t.get("brand_color", "#1F5AF6"),
                "date": t["created_at"], "icon": "card",
            })
    if type in ("all", "withdrawals"):
        for w in await db.withdrawals.find({"user_id": user["id"]}, {"_id": 0}).to_list(300):
            items.append({
                "currency": w.get("currency", "NGN"), "id": w["id"], "kind": "withdrawal", "title": "Withdrawal",
                "subtitle": f"To {w['destination']['provider_name']} ({w['destination']['account_number']})",
                "amount_kobo": w["amount_kobo"], "signed": -1, "status": _wd_status_label(w["status"]),
                "ref": w["ref"], "color": "#1F5AF6", "date": w["created_at"], "icon": "bank",
            })
    for l in await db.ledger.find({"user_id": user["id"], "type": "REFUND"}, {"_id": 0}).to_list(300):
        if type in ("all",):
            items.append({
                "id": l["id"], "kind": "refund", "title": "Refund", "subtitle": l["description"],
                "amount_kobo": abs(l["amount_kobo"]), "signed": 1 if l["amount_kobo"] > 0 else -1,
                "status": "Completed", "ref": l.get("ref_id", "")[:10].upper(),
                "color": "#DC2626", "date": l["created_at"], "icon": "refund",
            })
    if status:
        items = [i for i in items if i["status"].lower() == status.lower()]
    items.sort(key=lambda i: i["date"], reverse=True)
    return {"transactions": items}


# ===========================================================================
# NOTIFICATIONS
# ===========================================================================
@api.get("/notifications")
async def get_notifications(user: dict = Depends(current_user)):
    cur = db.notifications.find({"user_id": user["id"], "type": {"$ne": "kyc"}}, {"_id": 0}).sort("created_at", -1)
    items = await cur.to_list(100)
    unread = sum(1 for i in items if not i.get("read"))
    return {"notifications": items, "unread": unread}


@api.post("/notifications/read")
async def mark_read(user: dict = Depends(current_user)):
    await db.notifications.update_many({"user_id": user["id"], "read": False}, {"$set": {"read": True}})
    return {"ok": True}


@api.get("/notifications/since")
async def notifications_since(ts: str = "", user: dict = Depends(current_user)):
    """Lightweight poll for live in-app alerts. Returns notifications created after `ts` (ISO)."""
    server_time = now()
    if not ts:
        return {"notifications": [], "server_time": server_time}
    try:
        after = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        if after.tzinfo is None:
            after = after.replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(400, "Invalid timestamp")
    cur = db.notifications.find({"user_id": user["id"], "type": {"$ne": "kyc"}, "created_at": {"$gt": after}}, {"_id": 0}).sort("created_at", 1)
    return {"notifications": await cur.to_list(20), "server_time": server_time}


# ===========================================================================
# KYC (identity verification) — customer side
# ===========================================================================
def kyc_policy() -> dict:
    return {
        "id_types": [{"key": k, "label": v} for k, v in KYC_ID_TYPES.items()],
    }


def public_kyc(k: Optional[dict]) -> Optional[dict]:
    if not k:
        return None
    k = dict(k)
    k.pop("_id", None)
    n = k.get("id_number", "")
    k["id_number_masked"] = ("•" * max(0, len(n) - 4)) + n[-4:] if len(n) > 4 else "••••"
    k["id_type_label"] = KYC_ID_TYPES.get(k.get("id_type", ""), k.get("id_type", ""))
    return k


@api.get("/kyc")
async def get_kyc(user: dict = Depends(current_user)):
    latest = await db.kyc_submissions.find_one({"user_id": user["id"]}, sort=[("created_at", -1)])
    sub = public_kyc(latest)
    if sub:
        sub.pop("id_number", None)
    return {"status": user.get("kyc_status", "unverified"), "submission": sub, "policy": kyc_policy()}


@api.post("/kyc")
async def submit_kyc(x: KycIn, user: dict = Depends(current_user)):
    status = user.get("kyc_status", "unverified")
    if status == "verified":
        raise HTTPException(400, "Your identity is already verified")
    if status == "pending":
        raise HTTPException(400, "Your verification is already under review")
    if ".." in path or not re.fullmatch(r"bring-gift-card/uploads/[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+", path):
        raise HTTPException(400, "Invalid file path")
    owner_prefix = f"{APP_NAME}/uploads/{user['id']}/"
    for p in [x.id_front_path, x.selfie_path] + ([x.id_back_path] if x.id_back_path else []):
        if not p.startswith(owner_prefix):
            raise HTTPException(400, "Invalid document upload")
    ts = now()
    doc = {
        "id": new_id(), "user_id": user["id"], "id_type": x.id_type, "id_number": x.id_number.strip(),
        "full_name": x.full_name.strip(), "dob": x.dob.strip(), "address": x.address.strip(),
        "id_front_path": x.id_front_path, "id_back_path": x.id_back_path, "selfie_path": x.selfie_path,
        "status": "PENDING", "reason": "", "reviewed_at": None, "reviewed_by": "",
        "created_at": ts, "updated_at": ts,
    }
    await db.kyc_submissions.insert_one(doc)
    await db.users.update_one({"id": user["id"]}, {"$set": {"kyc_status": "pending", "kyc_submission_id": doc["id"]}})
    await notify(user["id"], "Verification submitted",
                 "Your identity documents were received and are under review.", "kyc", doc["id"])
    sub = public_kyc(doc)
    sub.pop("id_number", None)
    return {"status": "pending", "submission": sub}


# ===========================================================================
# REFERRAL — code/link tracking only; financial reward policy is not approved
# ===========================================================================
@api.get("/referral")
async def referral(user: dict = Depends(current_user)):
    full = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    referred = await db.users.find(
        {"referred_by": user["id"]},
        {"_id": 0, "id": 1, "full_name": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(200)
    referrer = None
    if full.get("referred_by"):
        r = await db.users.find_one({"id": full["referred_by"]}, {"_id": 0, "full_name": 1})
        referrer = r["full_name"] if r else None
    return {
        "code": full.get("referral_code", ""),
        "referred_count": len(referred),
        "referred": [{
            "id": r["id"],
            "name": r["full_name"].split(" ")[0] + (" " + r["full_name"].split(" ")[-1][0] + "." if " " in r["full_name"] else ""),
            "joined_at": r["created_at"],
        } for r in referred],
        "referred_by_name": referrer,
        "can_apply_code": not full.get("referred_by"),
    }


@api.post("/referral/apply")
async def referral_apply(x: ReferralApplyIn, user: dict = Depends(current_user)):
    """Link one referral code to an account. Financial reward policy is intentionally not implemented."""
    full = await db.users.find_one({"id": user["id"]}, {"_id": 0, "referred_by": 1, "referral_code": 1})
    if full.get("referred_by"):
        raise HTTPException(400, "A referral code is already linked to your account")
    code = x.code.strip().upper()
    if code == full.get("referral_code"):
        raise HTTPException(400, "You can't use your own referral code")
    referrer = await db.users.find_one({"referral_code": code, "disabled": {"$ne": True}}, {"_id": 0, "id": 1, "full_name": 1})
    if not referrer:
        raise HTTPException(400, "Referral code not found")
    await db.users.update_one({"id": user["id"]}, {"$set": {"referred_by": referrer["id"]}})
    return {"ok": True, "referred_by_name": referrer["full_name"]}


# ===========================================================================
# RECEIPTS — approved trades and paid withdrawals
# ===========================================================================
def _receipt_code(kind: str, ref: str) -> str:
    return hashlib.sha256(f"{JWT_SECRET}:{kind}:{ref}".encode()).hexdigest()[:8].upper()


@api.get("/receipts/trade/{trade_id}")
async def trade_receipt(trade_id: str, user: dict = Depends(current_user)):
    t = await db.trades.find_one({"id": trade_id, "user_id": user["id"]}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Trade not found")
    if t["status"] != "APPROVED":
        raise HTTPException(400, "Receipts are available once a trade is approved")
    payout = int(t.get("approved_payout_kobo") or t["expected_payout_kobo"])
    return {
        "kind": "trade", "title": "Trade Receipt", "receipt_no": f"RCT-{t['order_id']}", "ref": t["order_id"],
        "status": "APPROVED", "verification_code": _receipt_code("trade", t["order_id"]),
        "customer": {"name": user["full_name"], "email": user["email"]},
        "issued_at": now(), "created_at": t["created_at"], "completed_at": t.get("reviewed_at") or t.get("updated_at"),
        "lines": [
            {"label": "Gift card", "value": t["brand_name"]},
            {"label": "Card value", "value": f"${t['card_value_usd']:,} × {t['quantity']}"},
            {"label": "Type", "value": "E-code" if t["submission_type"] == "ecode" else "Physical card"},
            {"label": "Payout per card", "value": f"{t.get('currency', 'NGN')} {t.get('unit_payout_minor', t['rate_kobo_per_usd'] * t['card_value_usd']) / 10 ** t.get('minor_digits', 2):,.2f} per card"},
        ] + ([{"label": "Reviewer note", "value": t["admin_note"]}] if t.get("admin_note") else []),
        "currency": t.get("currency", "NGN"), "minor_digits": t.get("minor_digits", 2),
        "total_kobo": payout, "total_label": "Credited to wallet",
        "company": {"name": "Bring Gift Card", "support": "hello@bringgiftcard.com"},
    }


@api.get("/receipts/withdrawal/{withdrawal_id}")
async def withdrawal_receipt(withdrawal_id: str, user: dict = Depends(current_user)):
    w = await db.withdrawals.find_one({"id": withdrawal_id, "user_id": user["id"]}, {"_id": 0})
    if not w:
        raise HTTPException(404, "Withdrawal not found")
    if w["status"] != "PAID":
        raise HTTPException(400, "Receipts are available once a withdrawal is paid")
    d = w.get("destination", {})
    return {
        "kind": "withdrawal", "title": "Payout Receipt", "receipt_no": f"RCT-{w['ref']}", "ref": w["ref"],
        "status": "PAID", "verification_code": _receipt_code("withdrawal", w["ref"]),
        "customer": {"name": user["full_name"], "email": user["email"]},
        "issued_at": now(), "created_at": w["created_at"], "completed_at": w.get("paid_at") or w.get("updated_at"),
        "lines": [
            {"label": "Paid to", "value": d.get("provider_name", "")},
            {"label": "Account", "value": f"{d.get('account_number', '')} • {d.get('account_name', '')}"},
        ] + ([{"label": "Payment reference", "value": w["payment_reference"]}] if w.get("payment_reference") else [])
          + ([{"label": "Narration", "value": w["narration"]}] if w.get("narration") else []),
        "currency": w.get("currency", "NGN"), "minor_digits": w.get("minor_digits", 2),
        "total_kobo": int(w["amount_kobo"]), "total_label": "Amount paid",
        "company": {"name": "Bring Gift Card", "support": "hello@bringgiftcard.com"},
    }


# ===========================================================================
# SECURITY — transaction PIN
# ===========================================================================
@api.get("/security/pin")
async def pin_status(user: dict = Depends(current_user)):
    full = await db.users.find_one({"id": user["id"]}, {"_id": 0, "pin_hash": 1, "pin_locked_until": 1, "pin_set_at": 1, "password_hash": 1})
    locked = _aware(full.get("pin_locked_until")) if full else None
    return {
        "has_pin": bool(full and full.get("pin_hash")),
        "locked_until": locked if locked and locked > now() else None,
        "set_at": full.get("pin_set_at") if full else None,
        "can_reset_with_password": bool(full and full.get("password_hash")),
    }


@api.post("/security/pin")
async def set_pin(x: PinSetIn, user: dict = Depends(current_user)):
    full = await db.users.find_one({"id": user["id"]}, {"_id": 0, "pin_hash": 1})
    if len(set(x.pin)) == 1 or x.pin in ("1234", "0123", "4321", "9876"):
        raise HTTPException(400, "Choose a less predictable PIN")
    if full.get("pin_hash"):
        # Changing an existing PIN requires the current one (with lockout protection).
        await verify_pin_or_raise(user, x.current_pin)
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "pin_hash": hash_pw(x.pin), "pin_set_at": now(), "pin_failed": 0, "pin_locked_until": None}})
    await notify(user["id"], "Transaction PIN updated",
                 "Your transaction PIN was " + ("changed." if full.get("pin_hash") else "set. It is now required for withdrawals."), "security")
    return {"ok": True, "has_pin": True}


@api.post("/security/pin/reset")
async def reset_pin(x: PinResetIn, user: dict = Depends(current_user)):
    """Forgot PIN: re-authenticate with the account password (password accounts only)."""
    full = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 1})
    if not full.get("password_hash"):
        raise HTTPException(400, "This account signs in with Google. Please contact support to reset your PIN.")
    if not verify_pw(x.password, full["password_hash"]):
        raise HTTPException(401, "Incorrect account password")
    if len(set(x.pin)) == 1 or x.pin in ("1234", "0123", "4321", "9876"):
        raise HTTPException(400, "Choose a less predictable PIN")
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "pin_hash": hash_pw(x.pin), "pin_set_at": now(), "pin_failed": 0, "pin_locked_until": None}})
    await notify(user["id"], "Transaction PIN reset", "Your transaction PIN was reset using your password.", "security")
    return {"ok": True, "has_pin": True}


# ===========================================================================
# SUPPORT TICKETS
# ===========================================================================
TICKET_CATEGORIES = {"trade": "Trade issue", "withdrawal": "Withdrawal / payout", "account": "Account & login",
                     "kyc": "Identity verification", "other": "Other"}


def public_ticket(t: dict) -> dict:
    t = dict(t)
    t.pop("_id", None)
    t["category_label"] = TICKET_CATEGORIES.get(t.get("category", "other"), "Other")
    return t


async def _ticket_messages(ticket_id: str) -> list[dict]:
    return await db.support_messages.find({"ticket_id": ticket_id}, {"_id": 0}).sort("created_at", 1).to_list(500)


async def _add_message(ticket: dict, sender: str, sender_name: str, body: str, image_paths: list[str]) -> dict:
    msg = {"id": new_id(), "ticket_id": ticket["id"], "sender": sender, "sender_name": sender_name,
           "body": body.strip(), "image_paths": image_paths, "created_at": now()}
    await db.support_messages.insert_one(msg)
    msg.pop("_id", None)
    return msg


@api.get("/support/tickets")
async def my_tickets(user: dict = Depends(current_user)):
    docs = await db.support_tickets.find({"user_id": user["id"]}, {"_id": 0}).sort("last_message_at", -1).to_list(100)
    return {"tickets": [public_ticket(t) for t in docs],
            "unread": sum(int(t.get("unread_for_customer", 0)) for t in docs),
            "categories": [{"key": k, "label": v} for k, v in TICKET_CATEGORIES.items()]}


@api.post("/support/tickets")
async def create_ticket(x: TicketIn, user: dict = Depends(current_user)):
    await validate_uploads(x.image_paths, user)
    open_count = await db.support_tickets.count_documents({"user_id": user["id"], "status": {"$in": ["OPEN", "AWAITING_CUSTOMER"]}})
    if open_count >= 5:
        raise HTTPException(400, "You already have 5 open tickets. Please wait for a reply or close one first.")
    ref_label = ""
    if x.ref_type == "trade" and x.ref_id:
        t = await db.trades.find_one({"id": x.ref_id, "user_id": user["id"]}, {"_id": 0, "order_id": 1})
        if not t:
            raise HTTPException(400, "Trade reference not found")
        ref_label = t["order_id"]
    elif x.ref_type == "withdrawal" and x.ref_id:
        w = await db.withdrawals.find_one({"id": x.ref_id, "user_id": user["id"]}, {"_id": 0, "ref": 1})
        if not w:
            raise HTTPException(400, "Withdrawal reference not found")
        ref_label = w["ref"]
    ts = now()
    ticket = {
        "id": new_id(), "ref": order_ref("BGCS"), "user_id": user["id"], "customer_name": user["full_name"],
        "customer_email": user["email"], "subject": x.subject.strip(), "category": x.category,
        "ref_type": x.ref_type, "ref_id": x.ref_id, "ref_label": ref_label,
        "status": "OPEN", "unread_for_customer": 0, "unread_for_admin": 1,
        "last_message_at": ts, "last_message_preview": x.message.strip()[:120], "last_sender": "customer",
        "created_at": ts, "updated_at": ts, "resolved_at": None,
    }
    await db.support_tickets.insert_one(ticket)
    await _add_message(ticket, "customer", user["full_name"], x.message, x.image_paths)
    return public_ticket(ticket)


@api.get("/support/tickets/{ticket_id}")
async def get_ticket(ticket_id: str, user: dict = Depends(current_user)):
    t = await db.support_tickets.find_one({"id": ticket_id, "user_id": user["id"]}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Ticket not found")
    if t.get("unread_for_customer"):
        await db.support_tickets.update_one({"id": ticket_id}, {"$set": {"unread_for_customer": 0}})
        t["unread_for_customer"] = 0
    return {"ticket": public_ticket(t), "messages": await _ticket_messages(ticket_id)}


@api.post("/support/tickets/{ticket_id}/messages")
async def customer_reply(ticket_id: str, x: TicketMessageIn, user: dict = Depends(current_user)):
    await validate_uploads(x.image_paths, user)
    t = await db.support_tickets.find_one({"id": ticket_id, "user_id": user["id"]})
    if not t:
        raise HTTPException(404, "Ticket not found")
    if t["status"] == "CLOSED":
        raise HTTPException(400, "This ticket is closed. Please open a new one.")
    msg = await _add_message(t, "customer", user["full_name"], x.body, x.image_paths)
    await db.support_tickets.update_one({"id": ticket_id}, {"$set": {
        "status": "OPEN", "unread_for_admin": int(t.get("unread_for_admin", 0)) + 1, "last_message_at": msg["created_at"],
        "last_message_preview": msg["body"][:120], "last_sender": "customer", "updated_at": now(), "resolved_at": None}})
    return msg


@api.post("/support/tickets/{ticket_id}/close")
async def customer_close(ticket_id: str, user: dict = Depends(current_user)):
    t = await db.support_tickets.find_one({"id": ticket_id, "user_id": user["id"]})
    if not t:
        raise HTTPException(404, "Ticket not found")
    await db.support_tickets.update_one({"id": ticket_id}, {"$set": {"status": "CLOSED", "updated_at": now(), "resolved_at": now()}})
    return {"ok": True}


@api.get("/admin/support")
async def admin_tickets(status: str = "OPEN", q: str = "", admin: dict = Depends(require_admin)):
    query: dict = {}
    if status and status.lower() != "all":
        query["status"] = status
    if q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [{"subject": rx}, {"customer_name": rx}, {"customer_email": rx}, {"ref": rx}, {"ref_label": rx}]
    docs = await db.support_tickets.find(query, {"_id": 0}).sort("last_message_at", -1).to_list(300)
    return {"tickets": [public_ticket(t) for t in docs]}


@api.get("/admin/support/{ticket_id}")
async def admin_ticket_detail(ticket_id: str, admin: dict = Depends(require_admin)):
    t = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Ticket not found")
    if t.get("unread_for_admin"):
        await db.support_tickets.update_one({"id": ticket_id}, {"$set": {"unread_for_admin": 0}})
        t["unread_for_admin"] = 0
    u = await db.users.find_one({"id": t["user_id"]}, {"_id": 0, "password_hash": 0})
    return {"ticket": public_ticket(t), "messages": await _ticket_messages(ticket_id),
            "customer": public_user(u) if u else None}


@api.post("/admin/support/{ticket_id}/reply")
async def admin_reply(ticket_id: str, x: TicketMessageIn, admin: dict = Depends(require_admin)):
    await validate_uploads(x.image_paths, admin)
    t = await db.support_tickets.find_one({"id": ticket_id})
    if not t:
        raise HTTPException(404, "Ticket not found")
    msg = await _add_message(t, "admin", "Bring Gift Card Support", x.body, x.image_paths)
    await db.support_tickets.update_one({"id": ticket_id}, {"$set": {
        "status": "AWAITING_CUSTOMER", "unread_for_customer": int(t.get("unread_for_customer", 0)) + 1,
        "last_message_at": msg["created_at"], "last_message_preview": msg["body"][:120], "last_sender": "admin", "updated_at": now()}})
    await notify(t["user_id"], "Support replied", f"{t['ref']}: {msg['body'][:100]}", "support", ticket_id)
    return msg


@api.post("/admin/support/{ticket_id}/status")
async def admin_ticket_status(ticket_id: str, x: TicketStatusIn, admin: dict = Depends(require_admin)):
    t = await db.support_tickets.find_one({"id": ticket_id})
    if not t:
        raise HTTPException(404, "Ticket not found")
    upd = {"status": x.status, "updated_at": now(), "resolved_at": now() if x.status in ("RESOLVED", "CLOSED") else None}
    await db.support_tickets.update_one({"id": ticket_id}, {"$set": upd})
    if x.status == "RESOLVED":
        await notify(t["user_id"], "Ticket resolved", f"Your support ticket {t['ref']} has been marked resolved.", "support", ticket_id)
    return {"ok": True}


# ===========================================================================
# ADMIN
# ===========================================================================
@api.get("/admin/stats")
async def admin_stats(admin: dict = Depends(require_admin)):
    return {
        "pending_trades": await db.trades.count_documents({"status": {"$in": ["PENDING_REVIEW", "NEED_MORE_INFO"]}}),
        "pending_withdrawals": await db.withdrawals.count_documents({"status": {"$in": ["PENDING", "PROCESSING"]}}),
        "total_customers": await db.users.count_documents({"role": "customer"}),
        "total_brands": await db.brands.count_documents({}),
        "pending_kyc": await db.kyc_submissions.count_documents({"status": "PENDING"}),
        "open_tickets": await db.support_tickets.count_documents({"status": "OPEN"}),
    }


@api.get("/admin/trades")
async def admin_trades(status: str = "", admin: dict = Depends(require_admin)):
    query: dict = {}
    if status and status.lower() != "all":
        query["status"] = status
    cur = db.trades.find(query, {"_id": 0}).sort("created_at", -1)
    trades = await cur.to_list(300)
    # attach customer name
    for t in trades:
        u = await db.users.find_one({"id": t["user_id"]}, {"_id": 0, "full_name": 1, "email": 1})
        t["customer_name"] = u.get("full_name", "") if u else ""
        t["customer_email"] = u.get("email", "") if u else ""
        if t.get("ecode"):
            t["ecode_masked"] = ("•" * max(0, len(t["ecode"]) - 4)) + t["ecode"][-4:]
    return {"trades": trades}


@api.get("/admin/trades/{trade_id}")
async def admin_trade_detail(trade_id: str, admin: dict = Depends(require_admin)):
    t = await db.trades.find_one({"id": trade_id}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Trade not found")
    u = await db.users.find_one({"id": t["user_id"]}, {"_id": 0, "password_hash": 0})
    t["customer"] = public_user(u) if u else None
    t["ecode"] = decrypt(t.pop("ecode_encrypted", "")) or t.get("ecode", "")
    await production.audit(admin["id"], "trade.sensitive_access", trade_id)
    return t


@api.post("/admin/trades/{trade_id}/approve")
async def admin_approve(trade_id: str, x: AdminApproveIn, admin: dict = Depends(require_admin)):
    return await money.review(trade_id, "APPROVED", admin, x.approved_amount_kobo, x.note)

@api.post("/admin/trades/{trade_id}/reject")
async def admin_reject(trade_id: str, x: AdminReasonIn, admin: dict = Depends(require_admin)):
    return await money.review(trade_id, "REJECTED", admin, note=x.reason)

@api.post("/admin/trades/{trade_id}/need-info")
async def admin_need_info(trade_id: str, x: AdminReasonIn, admin: dict = Depends(require_admin)):
    return await money.review(trade_id, "NEED_MORE_INFO", admin, note=x.reason)


@api.get("/admin/withdrawals")
async def admin_withdrawals(status: str = "", admin: dict = Depends(require_admin)):
    query: dict = {}
    if status and status.lower() != "all":
        query["status"] = status
    cur = db.withdrawals.find(query, {"_id": 0}).sort("created_at", -1)
    ws = await cur.to_list(300)
    for w in ws:
        u = await db.users.find_one({"id": w["user_id"]}, {"_id": 0, "full_name": 1})
        w["customer_name"] = u.get("full_name", "") if u else ""
    return {"withdrawals": ws}


@api.post("/admin/withdrawals/{withdrawal_id}/paid")
async def admin_wd_paid(withdrawal_id: str, x: ManualPaidIn, admin: dict = Depends(require_admin)):
    return await money.settle(withdrawal_id, "PAID", admin["id"], "Company payment reference: " + x.external_reference, external_reference=x.external_reference)

@api.post("/admin/withdrawals/{withdrawal_id}/reject")
async def admin_wd_reject(withdrawal_id: str, x: AdminReasonIn, admin: dict = Depends(require_admin)):
    return await money.settle(withdrawal_id, "REJECTED", admin["id"], x.reason)


@api.get("/admin/brands")
async def admin_brands(admin: dict = Depends(require_admin)):
    cur = db.brands.find({}, {"_id": 0}).sort("sort_order", 1)
    return {"brands": await cur.to_list(300)}


@api.post("/admin/brands")
async def admin_create_brand(x: BrandIn, admin: dict = Depends(require_admin)):
    count = await db.brands.count_documents({})
    b = {"id": new_id(), "slug": x.name.lower().replace(" ", "-"), "sort_order": count + 1,
         "created_at": now(), **x.model_dump()}
    await db.brands.insert_one(b)
    b.pop("_id", None)
    return b


@api.patch("/admin/brands/{brand_id}")
async def admin_update_brand(brand_id: str, x: BrandIn, admin: dict = Depends(require_admin)):
    old = await db.brands.find_one({"id": brand_id})
    if not old:
        raise HTTPException(404, "Brand not found")
    await db.brands.update_one({"id": brand_id}, {"$set": x.model_dump()})
    if old.get("rate_kobo_per_usd") != x.rate_kobo_per_usd:
        await db.rate_changes.insert_one({
            "id": new_id(), "brand_id": brand_id, "brand_name": x.name, "old": old.get("rate_kobo_per_usd"),
            "new": x.rate_kobo_per_usd, "by": admin["id"], "by_name": admin["full_name"], "at": now(),
        })
    return await db.brands.find_one({"id": brand_id}, {"_id": 0})


# ---------------------------------------------------------------------------
# Admin rate history audit
# ---------------------------------------------------------------------------
def public_rate_change(c: dict) -> dict:
    c = dict(c)
    c.pop("_id", None)
    old, new = int(c.get("old") or 0), int(c.get("new") or 0)
    c["delta_kobo"] = new - old
    c["delta_pct"] = round((new - old) / old * 100, 2) if old else None
    return c


@api.get("/admin/rate-history")
async def admin_rate_history(brand_id: str = "", limit: int = 200, admin: dict = Depends(require_admin)):
    q: dict = {"brand_id": brand_id} if brand_id else {}
    docs = await db.rate_changes.find(q).sort("at", -1).to_list(min(max(limit, 1), 500))
    names = {b["id"]: b["name"] for b in await db.brands.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(300)}
    admins = {u["id"]: u["full_name"] for u in await db.users.find({"role": "admin"}, {"_id": 0, "id": 1, "full_name": 1}).to_list(50)}
    out = []
    for d in docs:
        d.setdefault("brand_name", names.get(d["brand_id"], "Unknown"))
        d.setdefault("by_name", admins.get(d.get("by", ""), "Admin"))
        out.append(public_rate_change(d))
    # per-brand summary for the filter chips
    summary = {}
    async for row in db.rate_changes.aggregate([{"$group": {"_id": "$brand_id", "n": {"$sum": 1}, "last": {"$max": "$at"}}}]):
        summary[row["_id"]] = {"count": row["n"], "last_at": row["last"], "name": names.get(row["_id"], "Unknown")}
    return {"changes": out, "brands": [{"brand_id": k, **v} for k, v in sorted(summary.items(), key=lambda kv: kv[1]["last_at"], reverse=True)]}



@api.get("/admin/users")
async def admin_users(q: str = "", kyc: str = "", admin: dict = Depends(require_admin)):
    query: dict = {}
    if q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [{"full_name": rx}, {"email": rx}, {"phone": rx}, {"referral_code": rx}]
    if kyc:
        query["kyc_status"] = kyc
    cur = db.users.find(query, {"_id": 0, "password_hash": 0}).sort("created_at", -1)
    users = await cur.to_list(200)
    out = []
    for u in users:
        out.append({
            **public_user(u), "created_at": u.get("created_at"), "disabled": u.get("disabled", False),
            "balance_kobo": await balance_kobo(u["id"]),
            "trades_count": await db.trades.count_documents({"user_id": u["id"]}),
        })
    return {"users": out}


@api.get("/admin/users/{user_id}")
async def admin_user_detail(user_id: str, admin: dict = Depends(require_admin)):
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not u:
        raise HTTPException(404, "Customer not found")
    trades = await db.trades.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    withdrawals = await db.withdrawals.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    ledger = await db.ledger.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    accounts = await db.payout_accounts.find({"user_id": user_id, "deleted_at": None}, {"_id": 0}).to_list(10)
    kyc = await db.kyc_submissions.find_one({"user_id": user_id}, sort=[("created_at", -1)])
    tickets = await db.support_tickets.find({"user_id": user_id}, {"_id": 0}).sort("last_message_at", -1).to_list(50)
    approved = [t for t in trades if t["status"] == "APPROVED"]
    return {
        "user": {**public_user(u), "created_at": u.get("created_at"), "disabled": u.get("disabled", False),
                 "referral_code": u.get("referral_code", ""), "last_login_at": u.get("last_login_at")},
        "balance_kobo": await balance_kobo(user_id),
        "stats": {
            "trades": len(trades), "approved_trades": len(approved),
            "total_traded_kobo": sum(int(t.get("approved_payout_kobo") or 0) for t in approved),
            "withdrawals": len(withdrawals),
            "total_withdrawn_kobo": sum(int(w["amount_kobo"]) for w in withdrawals if w["status"] == "PAID"),
            "referred_count": await db.users.count_documents({"referred_by": user_id}),
        },
        "trades": [public_trade(t) for t in trades],
        "withdrawals": withdrawals,
        "ledger": ledger,
        "payout_accounts": accounts,
        "kyc": public_kyc(kyc),
        "tickets": [public_ticket(t) for t in tickets],
    }


# ---------------------------------------------------------------------------
# Admin KYC review
# ---------------------------------------------------------------------------
async def _attach_customer(docs: list[dict]) -> None:
    for d in docs:
        u = await db.users.find_one({"id": d["user_id"]}, {"_id": 0, "full_name": 1, "email": 1})
        d["customer_name"] = u.get("full_name", "") if u else ""
        d["customer_email"] = u.get("email", "") if u else ""


@api.get("/admin/kyc")
async def admin_kyc_list(status: str = "PENDING", admin: dict = Depends(require_admin)):
    query: dict = {}
    if status and status.lower() != "all":
        query["status"] = status
    docs = await db.kyc_submissions.find(query, {"_id": 0}).sort("created_at", 1 if status == "PENDING" else -1).to_list(300)
    await _attach_customer(docs)
    return {"submissions": [public_kyc(d) for d in docs]}


@api.get("/admin/kyc/{kyc_id}")
async def admin_kyc_detail(kyc_id: str, admin: dict = Depends(require_admin)):
    k = await db.kyc_submissions.find_one({"id": kyc_id}, {"_id": 0})
    if not k:
        raise HTTPException(404, "Submission not found")
    u = await db.users.find_one({"id": k["user_id"]}, {"_id": 0, "password_hash": 0})
    out = public_kyc(k)
    out["customer"] = public_user(u) if u else None
    return out  # admin may see the full id_number


async def _review_kyc(kyc_id: str, admin: dict, verdict: str, reason: str) -> dict:
    k = await db.kyc_submissions.find_one({"id": kyc_id})
    if not k:
        raise HTTPException(404, "Submission not found")
    if k["status"] != "PENDING":
        raise HTTPException(400, "Submission already reviewed")
    ts = now()
    await db.kyc_submissions.update_one({"id": kyc_id}, {"$set": {
        "status": verdict, "reason": reason, "reviewed_at": ts, "reviewed_by": admin["id"], "updated_at": ts}})
    await db.users.update_one({"id": k["user_id"]}, {"$set": {"kyc_status": "verified" if verdict == "VERIFIED" else "rejected"}})
    return k


@api.post("/admin/kyc/{kyc_id}/approve")
async def admin_kyc_approve(kyc_id: str, admin: dict = Depends(require_admin)):
    k = await _review_kyc(kyc_id, admin, "VERIFIED", "")
    await notify(k["user_id"], "Identity verified",
                 "Your identity verification has been approved.", "kyc", kyc_id)
    return {"ok": True}


@api.post("/admin/kyc/{kyc_id}/reject")
async def admin_kyc_reject(kyc_id: str, x: AdminReasonIn, admin: dict = Depends(require_admin)):
    if not x.reason.strip():
        raise HTTPException(400, "A reason is required")
    k = await _review_kyc(kyc_id, admin, "REJECTED", x.reason.strip())
    await notify(k["user_id"], "Verification needs attention",
                 f"Your identity verification was not approved: {x.reason.strip()}. You can resubmit.", "kyc", kyc_id)
    return {"ok": True}


# ===========================================================================
# DATABASE STARTUP
# ===========================================================================
async def ensure_indexes():
    """Create indexes only. Startup must never create users, balances, trades, or rates."""
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.ledger.create_index("dedup_key", unique=True)
    await db.ledger.create_index("user_id")
    await db.brands.create_index("id", unique=True)
    await db.trades.create_index("id", unique=True)
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.kyc_submissions.create_index([("user_id", 1), ("created_at", -1)])
    await db.kyc_submissions.create_index("status")
    await db.support_tickets.create_index([("user_id", 1), ("last_message_at", -1)])
    await db.support_tickets.create_index("status")
    await db.support_messages.create_index([("ticket_id", 1), ("created_at", 1)])
    await db.users.create_index("referral_code")
    await db.users.create_index("referred_by")
    await db.users.create_index("phone", unique=True, partialFilterExpression={"phone": {"$type": "string", "$gt": ""}})
    await db.withdrawals.create_index("id", unique=True)
    await db.withdrawals.create_index([("user_id", 1), ("request_key", 1)], unique=True, partialFilterExpression={"request_key": {"$type": "string"}})
    await db.markets.create_index("code", unique=True)
    await db.payout_providers.create_index("id", unique=True)
    await db.settings.create_index("id", unique=True)
    await db.legal.create_index("id", unique=True)
    await db.card_rates.create_index([("brand_id", 1), ("market_code", 1), ("face_value", 1)], unique=True)
    await db.uploads.create_index("path", unique=True)
    await db.abuse_counters.create_index("expires_at", expireAfterSeconds=0)
    await db.password_resets.create_index("expires_at", expireAfterSeconds=0)
    await db.rate_changes.create_index([("brand_id", 1), ("at", -1)])


@app.on_event("startup")
async def on_start():
    hello = await db.command("hello")
    if not hello.get("setName") and hello.get("msg") != "isdbgrid":
        raise RuntimeError("MongoDB replica set or Atlas is required for atomic financial transactions")
    if IS_PRODUCTION:
        encrypt("configuration-check")
    try:
        await ensure_indexes()
    except Exception:
        logger.exception("database index initialization failed")
        raise
    if STORAGE_URL and OBJECT_STORAGE_KEY:
        try:
            await run_in_threadpool(_init_storage)
        except Exception:
            logger.warning("storage init deferred")


@api.get("/")
async def root():
    return {"service": "Bring Gift Card API", "status": "ok"}


money = Money(sys.modules[__name__])
production = Production(sys.modules[__name__])
app.include_router(production.router())
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown():
    client.close()

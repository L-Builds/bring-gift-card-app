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
import secrets
import hashlib
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

import jwt
import httpx
import requests
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, UploadFile, File, Query, Request
from fastapi.responses import Response, JSONResponse, RedirectResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from persistence import Database, DuplicateKeyError, ReturnDocument
from pydantic import BaseModel, EmailStr, Field
from passlib.context import CryptContext
from money import Money
from production import Production, encrypt, decrypt, ManualPaidIn
from payout_providers import ProviderError
from private_services import clean_image, clean_brand_logo, put_private, get_private, send_reset
from legal_documents import default_legal
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
APP_ENV = os.environ.get("APP_ENV", "development").strip().lower()
IS_PRODUCTION = APP_ENV == "production"

DATABASE_URL = os.environ["DATABASE_URL"]
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
STAFF_ROLES = {"general_manager", "manager", "worker"}
WORKER_SCOPES = {"trades", "withdrawals", "support", "customers"}


def valid_admin_password(password: str) -> bool:
    return password.endswith("@admin") and len(password) >= 12 and len(password.encode("utf-8")) <= 72


def staff_role(user: dict) -> str:
    # Existing admin rows predate staff roles. Migration 004 marks them manager.
    return user.get("staff_role") or "manager"


def staff_permissions(user: dict) -> list[str]:
    permissions = user.get("staff_permissions") or []
    if not isinstance(permissions, list):
        return []
    return sorted(set(permissions) & WORKER_SCOPES)

db = Database(DATABASE_URL, os.environ.get("DATABASE_SCHEMA", "public"))

app = FastAPI(title="Bring Gift Card API", docs_url=None if IS_PRODUCTION else "/docs", redoc_url=None if IS_PRODUCTION else "/redoc")
api = APIRouter(prefix="/api")


@app.get("/", include_in_schema=False)
async def open_app():
    app_url = os.environ.get("PUBLIC_APP_URL", "").strip().rstrip("/")
    return RedirectResponse((app_url or "https://bring-gift-card-app.vercel.app") + "/", status_code=307)

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


def new_referral_code() -> str:
    return "BGC" + secrets.token_hex(6).upper()


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
    if staff_role(user) not in {"general_manager", "manager"}:
        raise HTTPException(403, "Management access required")
    return user


async def require_staff(user: dict = Depends(current_user)) -> dict:
    if user.get("role") != "admin" or staff_role(user) not in STAFF_ROLES:
        raise HTTPException(403, "Admins only")
    return user


def require_staff_scope(scope: str):
    if scope not in WORKER_SCOPES:
        raise ValueError("Unknown staff scope")

    async def check(user: dict = Depends(current_user)) -> dict:
        if user.get("role") != "admin":
            raise HTTPException(403, "Admins only")
        if staff_role(user) == "worker" and scope not in staff_permissions(user):
            raise HTTPException(403, "This work area is not assigned to your account")
        if staff_role(user) not in STAFF_ROLES:
            raise HTTPException(403, "Invalid staff role")
        return user

    return check


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


async def notify(user_id: str, title: str, body: str, ntype: str, ref_id: str = "", session=None) -> None:
    await db.notifications.insert_one({
        "id": new_id(), "user_id": user_id, "title": title, "body": body,
        "type": ntype, "ref_id": ref_id, "read": False, "created_at": now(),
    }, session=session)


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


class PasswordChangeIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=72)
    new_password: str = Field(min_length=10, max_length=72)


class SessionRevokeOthersIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=72)


class AdminNotificationPreferenceIn(BaseModel):
    notifications_enabled: bool


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


class StaffCreateIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=12, max_length=72)
    staff_role: Literal["manager", "worker"]
    staff_permissions: List[Literal["trades", "withdrawals", "support", "customers"]] = Field(default_factory=list)


class StaffUpdateIn(BaseModel):
    disabled: Optional[bool] = None
    staff_permissions: Optional[List[Literal["trades", "withdrawals", "support", "customers"]]] = None
    password: Optional[str] = Field(default=None, min_length=12, max_length=72)


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


class PopularCardAddIn(BaseModel):
    brand_id: str = Field(min_length=1, max_length=120)


class PopularCardBonusIn(BaseModel):
    bonus_enabled: bool = False
    bonus_market_code: Optional[str] = Field(default=None, max_length=16)
    bonus_amount_minor: Optional[int] = Field(default=None, gt=0, le=9000000000000)
    min_card_value_usd: Optional[int] = Field(default=None, gt=0, le=1000000)


class PopularCardReorderIn(BaseModel):
    brand_ids: List[str] = Field(min_length=1, max_length=8)


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------
def public_user(u: dict) -> dict:
    result = {
        "id": u["id"], "full_name": u["full_name"], "email": u["email"],
        "phone": u.get("phone", ""), "role": u.get("role", "customer"),
        "currency": u.get("currency", "NGN"), "minor_digits": u.get("minor_digits", 2), "market_code": u.get("market_code", "NG"),
        "country": u.get("country", "Nigeria"), "kyc_status": u.get("kyc_status", "unverified"),
        "notifications_enabled": u.get("notifications_enabled", True),
        "auth_provider": u.get("auth_provider", "password"), "picture": u.get("picture", ""),
        "has_pin": bool(u.get("pin_hash")),
    }
    if u.get("role") == "admin":
        result["staff_role"] = staff_role(u)
        result["staff_permissions"] = staff_permissions(u)
    return result


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
        raise HTTPException(422, "Accept the Terms of Service and acknowledge the Privacy Policy to register")
    terms_doc = await db.legal.find_one({"id": "terms", "published_override": True}, {"_id": 0}) or default_legal("terms")
    privacy_doc = await db.legal.find_one({"id": "privacy", "published_override": True}, {"_id": 0}) or default_legal("privacy")
    email = str(x.email).strip().lower()
    phone = x.phone.strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email already registered")
    if await db.users.find_one({"phone": phone}):
        raise HTTPException(409, "Phone number already registered")
    referrer = None
    if x.referral_code.strip():
        code = x.referral_code.strip().upper()
        referrer = await db.users.find_one({"referral_code": {"$regex": "^" + re.escape(code) + "$", "$options": "i"},
                                           "disabled": {"$ne": True}}, {"_id": 0, "id": 1})
        if not referrer:
            raise HTTPException(400, "Referral code not found")
    user = {
        "id": new_id(), "full_name": x.full_name.strip(), "email": email,
        "phone": phone, "password_hash": hash_pw(x.password),
        "role": "customer", "country": market["name"], "market_code": market["code"], "currency": market["currency"], "minor_digits": market["minor_digits"],
        "terms_accepted_at": now(), "terms_version": int(terms_doc.get("version", 1)), "privacy_version": int(privacy_doc.get("version", 1)), "kyc_status": "unverified",
        "notifications_enabled": True, "disabled": False,
        "referral_code": new_referral_code(), "created_at": now(),
        "referred_by": referrer["id"] if referrer else None,
    }
    for _ in range(5):
        try:
            await db.users.insert_one(user)
            break
        except DuplicateKeyError:
            if await db.users.find_one({"email": email}) or await db.users.find_one({"phone": phone}):
                raise HTTPException(409, "Account already registered")
            collision = await db.users.find_one({"referral_code": {
                "$regex": "^" + re.escape(user["referral_code"]) + "$", "$options": "i"}})
            if collision:
                user["referral_code"] = new_referral_code()
                continue
            raise HTTPException(409, "Account already registered")
    else:
        raise HTTPException(503, "Could not allocate a referral code; please retry")
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
    if (not user or not verify_pw(x.password, user.get("password_hash", "")) or user.get("disabled")
            or (user.get("role") == "admin" and not valid_admin_password(x.password))):
        raise HTTPException(401, error_message)
    return {"access_token": make_token(user), "user": public_user(user)}


@api.get("/auth/me")
async def me(user: dict = Depends(current_user)):
    return {"user": public_user(user), "balance_kobo": await balance_kobo(user["id"])}


@api.post("/auth/password/change")
async def change_password(x: PasswordChangeIn, user: dict = Depends(current_user)):
    if len(x.new_password.encode("utf-8")) > 72:
        raise HTTPException(422, "Password is too long in UTF-8 bytes")

    async def run(session):
        account = await db.users.find_one({"id": user["id"], "disabled": {"$ne": True}}, session=session, for_update=True)
        if not account or not account.get("password_hash"):
            raise HTTPException(409, "This account does not have a password that can be changed here")
        if not verify_pw(x.current_password, account["password_hash"]):
            raise HTTPException(401, "Current password is incorrect")
        if verify_pw(x.new_password, account["password_hash"]):
            raise HTTPException(422, "Choose a new password that is different from the current password")
        if account.get("role") == "admin" and not valid_admin_password(x.new_password):
            raise HTTPException(422, "Admin password must be 12–72 UTF-8 bytes and end with @admin")

        updated = await db.users.find_one_and_update(
            {"id": account["id"]},
            {"$set": {"password_hash": hash_pw(x.new_password), "password_changed_at": now()},
             "$inc": {"token_version": 1}},
            return_document=ReturnDocument.AFTER, session=session)
        await db.audit.insert_one({
            "actor": account["id"], "action": "security.password_changed",
            "target": account["id"], "at": now(),
        }, session=session)
        return updated

    updated = await db.transaction(run)
    token = make_token(updated)
    return {
        "message": "Password changed. Other signed-in sessions were logged out.",
        "access_token": token,
        "user": public_user(updated),
    }


@api.patch("/auth/admin-notifications")
async def update_admin_notifications(x: AdminNotificationPreferenceIn, user: dict = Depends(current_user)):
    if user.get("role") != "admin" or staff_role(user) not in STAFF_ROLES:
        raise HTTPException(403, "Admins only")

    async def run(session):
        updated = await db.users.find_one_and_update(
            {"id": user["id"]},
            {"$set": {"notifications_enabled": x.notifications_enabled}},
            return_document=ReturnDocument.AFTER, session=session,
        )
        await db.audit.insert_one({
            "actor": user["id"], "action": "preferences.admin_notifications",
            "target": user["id"], "enabled": x.notifications_enabled, "at": now(),
        }, session=session)
        return updated

    updated = await db.transaction(run)
    return {"user": public_user(updated)}


@api.post("/auth/sessions/revoke-others")
async def revoke_other_sessions(x: SessionRevokeOthersIn, user: dict = Depends(current_user)):
    async def run(session):
        account = await db.users.find_one({"id": user["id"], "disabled": {"$ne": True}}, session=session, for_update=True)
        if not account or not account.get("password_hash"):
            raise HTTPException(409, "This account does not have a password that can verify this action")
        if not verify_pw(x.current_password, account["password_hash"]):
            raise HTTPException(401, "Current password is incorrect")

        updated = await db.users.find_one_and_update(
            {"id": account["id"]},
            {"$set": {"sessions_reset_at": now()}, "$inc": {"token_version": 1}},
            return_document=ReturnDocument.AFTER, session=session)
        await db.audit.insert_one({
            "actor": account["id"], "action": "security.other_sessions_revoked",
            "target": account["id"], "at": now(),
        }, session=session)
        return updated

    updated = await db.transaction(run)
    token = make_token(updated)
    return {
        "message": "Other signed-in sessions were logged out. This device remains signed in.",
        "access_token": token,
        "user": public_user(updated),
    }


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
    if user and user.get("role") == "admin":
        raise HTTPException(403, "Admin accounts require password sign-in")
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
        account = await db.users.find_one({"id": doc["user_id"]}, session=session)
        if not account:
            raise HTTPException(400, "Invalid or expired reset token")
        if account.get("role") == "admin" and not valid_admin_password(x.password):
            raise HTTPException(422, "Admin password must be 12–72 UTF-8 bytes and end with @admin")
        await db.users.update_one({"id": doc["user_id"]}, {"$set": {"password_hash": hashed},
            "$inc": {"token_version": 1}}, session=session)
    await money.transaction(run)
    return {"message": "Password updated. Please log in."}


# ===========================================================================
# CATALOG / RATES  (public rates are read-only for guests)
# ===========================================================================
def brand_response(brand: dict, *, tradable: bool = False) -> dict:
    """Expose a stable public logo URL without exposing the private object key."""
    result = {k: v for k, v in brand.items() if k not in {"_id", "logo_path"}}
    path = brand.get("logo_path") or ""
    result["has_logo"] = bool(path)
    result["logo_version"] = hashlib.sha256(path.encode()).hexdigest()[:12] if path else ""
    result["is_tradable"] = tradable
    return result


def brand_logo_metadata(brand: Optional[dict]) -> dict:
    path = (brand or {}).get("logo_path") or ""
    return {"brand_has_logo": bool(path),
            "brand_logo_version": hashlib.sha256(path.encode()).hexdigest()[:12] if path else ""}


async def attach_brand_logos(trades: list[dict]) -> None:
    ids = sorted({t.get("brand_id") for t in trades if t.get("brand_id")})
    if not ids:
        return
    brands = await db.brands.find({"id": {"$in": ids}}, {"id": 1, "logo_path": 1}).to_list(len(ids))
    by_id = {b["id"]: b for b in brands}
    for trade in trades:
        trade.update(brand_logo_metadata(by_id.get(trade.get("brand_id"))))


async def rate_view_brand_ids(market_code: str = "") -> set[str]:
    """Cards with an active independent headline rate for an active payout market."""
    market_filter: dict = {"code": market_code, "is_active": True} if market_code else {"is_active": True}
    markets = await db.markets.distinct("code", market_filter)
    if not markets:
        return set()
    ids = await db.headline_rates.distinct("brand_id", {
        "market_code": {"$in": markets}, "is_active": True, "archived_at": None,
        "rate_minor_per_unit": {"$gt": 0},
    })
    return set(ids)


async def tradable_brand_ids(market_code: str = "") -> set[str]:
    """Cards with at least one active detailed country/type rate for an active market."""
    market_filter: dict = {"code": market_code, "is_active": True} if market_code else {"is_active": True}
    markets = await db.markets.distinct("code", market_filter)
    if not markets:
        return set()
    ids = await db.detailed_rates.distinct("brand_id", {
        "market_code": {"$in": markets}, "is_active": True, "archived_at": None,
        "submission_type": {"$in": ["physical", "ecode"]},
        "rate_minor_per_unit": {"$gt": 0},
    })
    return set(ids)


@api.get("/brands")
async def list_brands(popular: bool = False, category: str = "", q: str = "", market_code: str = "", purpose: Literal["trade", "rates"] = "trade"):
    tradable_ids = await tradable_brand_ids(market_code)
    ids = await rate_view_brand_ids(market_code) if purpose == "rates" else tradable_ids
    if not ids:
        return {"brands": []}
    popular_order: list[str] = []
    query: dict = {"is_active": True, "id": {"$in": sorted(ids)}}
    if popular:
        popular_rows = await db.popular_cards.find({}, {"_id": 0}).sort("position", 1).to_list(8)
        popular_order = [row["brand_id"] for row in popular_rows]
        if not popular_order:
            return {"brands": []}
        query["id"] = {"$in": [brand_id for brand_id in popular_order if brand_id in ids]}
    if category and category.lower() != "all":
        query["category"] = category
    if q:
        query["name"] = {"$regex": re.escape(q), "$options": "i"}
    cur = db.brands.find(query, {"_id": 0}).sort("sort_order", 1)
    brands = await cur.to_list(500)
    if popular:
        positions = {brand_id: index for index, brand_id in enumerate(popular_order)}
        brands.sort(key=lambda brand: positions.get(brand["id"], 999))
    return {"brands": [brand_response(b, tradable=b["id"] in tradable_ids) for b in brands
                       if b.get("submission_types", ["physical", "ecode"])][:200]}


@api.get("/popular-cards")
async def public_popular_cards(market_code: str = ""):
    """Curated Home Popular Gift Cards for guests and signed-in customers.

    The displayed main rate always comes from the admin-selected headline rate
    for the requested payout market. Optional bonus presentation data comes
    from the dedicated Popular Gift Cards collection.
    """
    code = market_code.strip().upper()
    market_query = {"code": code, "is_active": True} if code else {"is_active": True}
    market = await db.markets.find_one(market_query, {"_id": 0})
    if not market:
        return {"popular_cards": [], "market": None}

    rows = await db.popular_cards.find({}, {"_id": 0}).sort("position", 1).to_list(8)
    tradable_ids = await tradable_brand_ids(market["code"])
    items = []
    for row in rows:
        brand = await db.brands.find_one({"id": row["brand_id"], "is_active": True}, {"_id": 0})
        if not brand or brand.get("archived_at") or row["brand_id"] not in tradable_ids:
            continue
        headline = await db.headline_rates.find_one({
            "brand_id": row["brand_id"],
            "market_code": market["code"],
            "is_active": True,
        }, {"_id": 0})
        if not headline:
            continue

        bonus = None
        if row.get("bonus_enabled") and row.get("bonus_market_code") and row.get("bonus_amount_minor"):
            bonus_market = await db.markets.find_one({
                "code": row["bonus_market_code"],
                "is_active": True,
            }, {"_id": 0})
            if bonus_market:
                bonus = {
                    "enabled": True,
                    "market_code": bonus_market["code"],
                    "currency": bonus_market["currency"],
                    "minor_digits": bonus_market.get("minor_digits", 2),
                    "amount_minor": row["bonus_amount_minor"],
                    "min_card_value_usd": row.get("min_card_value_usd"),
                }

        items.append({
            "position": row["position"],
            "brand": brand_response(brand, tradable=True),
            "headline_rate": headline,
            "bonus": bonus,
        })

    return {
        "popular_cards": items,
        "market": {
            "code": market["code"],
            "name": market["name"],
            "currency": market["currency"],
            "minor_digits": market.get("minor_digits", 2),
        },
    }


@api.get("/brands/{brand_id}")
async def get_brand(brand_id: str, market_code: str = ""):
    b = await db.brands.find_one({"id": brand_id, "is_active": True}, {"_id": 0})
    if not b or not b.get("submission_types", ["physical", "ecode"]) or brand_id not in await tradable_brand_ids(market_code):
        raise HTTPException(404, "Card not found")
    return brand_response(b, tradable=True)


@api.get("/categories")
async def categories(market_code: str = ""):
    ids = await tradable_brand_ids(market_code)
    if not ids:
        return {"categories": ["All"]}
    cats = await db.brands.distinct("category", {"is_active": True, "id": {"$in": sorted(ids)}})
    return {"categories": ["All"] + sorted(cats)}


@api.get("/brands/{brand_id}/logo")
async def brand_logo(brand_id: str, request: Request):
    brand = await db.brands.find_one({"id": brand_id}, {"logo_path": 1})
    path = (brand or {}).get("logo_path") or ""
    if not re.fullmatch(rf"{re.escape(APP_NAME)}/brand-logos/{re.escape(brand_id)}/[a-f0-9]{{32}}\.png", path):
        raise HTTPException(404, "Logo not found")
    etag = '"' + hashlib.sha256(path.encode()).hexdigest()[:12] + '"'
    headers = {"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff", "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    try:
        content, _ = await run_in_threadpool(get_private if os.environ.get("S3_BUCKET") else _get_object, path)
    except Exception:
        logger.exception("brand logo read failed")
        raise HTTPException(404, "Logo not found")
    return Response(content=content, media_type="image/png", headers=headers)


# ===========================================================================
# UPLOADS  (private; owner/admin read only)
# ===========================================================================
async def store_image(path, data):
    if os.environ.get("S3_BUCKET"):
        await run_in_threadpool(put_private, path, data)
    else:
        await run_in_threadpool(_put_object, path, data, "image/jpeg")


async def store_brand_logo(path, data):
    if os.environ.get("S3_BUCKET"):
        await run_in_threadpool(put_private, path, data, "image/png")
    else:
        await run_in_threadpool(_put_object, path, data, "image/png")


@api.post("/uploads")
async def upload_file(user: dict = Depends(current_user), file: UploadFile = File(...)):
    ext = (file.filename or "img.jpg").split(".")[-1].lower()[:5] or "jpg"
    data = await file.read(12 * 1024 * 1024 + 1)
    if len(data) > 12 * 1024 * 1024:
        raise HTTPException(413, "Image too large (max 12MB)")
    data = await run_in_threadpool(clean_image, data)
    path = f"{APP_NAME}/uploads/{user['id']}/{new_id()}.jpg"
    try:
        await store_image(path, data)
    except Exception as e:
        logger.exception("upload failed")
        raise HTTPException(502, "Upload failed, please retry")
    await db.uploads.insert_one({"path": path, "user_id": user["id"], "created_at": now()})
    return {"path": path}


@api.get("/files/{path:path}")
async def get_file(path: str, request: Request, creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)):
    jwt_token = creds.credentials if creds else ""
    user = await _user_from_token(jwt_token) if jwt_token else None
    if not user:
        raise HTTPException(401, "Not authenticated")
    if ".." in path or not re.fullmatch(r"bring-gift-card/uploads/[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+", path):
        raise HTTPException(400, "Invalid file path")
    owner_prefix = f"{APP_NAME}/uploads/{user['id']}/"
    if not path.startswith(owner_prefix):
        if user.get("role") == "admin":
            if staff_role(user) == "worker":
                scopes = staff_permissions(user)
                allowed = (
                    ("trades" in scopes and bool(await db.trades.find_one({"image_paths": path})))
                    or ("support" in scopes and bool(await db.support_messages.find_one({"image_paths": path})))
                )
                if not allowed:
                    raise HTTPException(403, "This attachment is outside your assigned work")
        else:
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
    headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes"}
    requested=request.headers.get("range")
    if requested:
        match=re.fullmatch(r"bytes=(\d+)-(\d+)",requested)
        if not match:raise HTTPException(416,"Use a bounded byte range")
        start,end=map(int,match.groups())
        if start>=len(content) or end<start or end-start+1>3*1024*1024:
            raise HTTPException(416,"Invalid or oversized byte range",headers={"Content-Range":f"bytes */{len(content)}"})
        end=min(end,len(content)-1)
        headers["Content-Range"]=f"bytes {start}-{end}/{len(content)}"
        return Response(content=content[start:end+1],status_code=206,media_type=ctype,headers=headers)
    return Response(content=content, media_type=ctype, headers=headers)


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
    country = x.country.strip().upper()
    if not country:
        raise HTTPException(400, "Select the card country / region")
    market_code = user.get("market_code", "NG")
    published_country_type = await db.detailed_rates.find_one({
        "brand_id": brand["id"], "market_code": market_code,
        "card_country": country, "submission_type": x.submission_type,
        "is_active": True, "archived_at": None,
    }, {"id": 1})
    if not published_country_type:
        raise HTTPException(400, "Selected country / region and card type are not available for this card")
    if x.submission_type == "physical" and not x.image_paths:
        raise HTTPException(400, "Please upload at least one clear image of the card")
    if x.submission_type == "ecode" and not x.ecode.strip():
        raise HTTPException(400, "Please enter the e-code / card details")
    await validate_uploads(x.image_paths, user)
    async def submit(session):
        # Hold the rate row until the trade is recorded. A concurrent admin rate
        # publication must either precede this version check or follow the trade.
        quote = await production.quote(
            x.brand_id, x.card_value_usd, x.quantity, user,
            card_country=x.country, submission_type=x.submission_type,
            session=session, lock_rows=True,
        )
        if quote["rate_version"] != x.rate_version:
            raise HTTPException(409, "Rate changed. Refresh the quote and review before submitting.")
        payout = quote["payout_minor"]
        rate = quote["rate_minor_per_unit"]
        ts = now()
        trade = {
            "id": new_id(), "order_id": order_ref("BGC"), "user_id": user["id"],
            "brand_id": brand["id"], "brand_name": brand["name"], "brand_color": brand.get("color", "#1F5AF6"),
            "category": brand.get("category", ""), "submission_type": x.submission_type,
            "subcategory": x.subcategory, "country": country,
            "card_value_usd": x.card_value_usd, "quantity": x.quantity,
            "rate_kobo_per_usd": rate, "expected_payout_kobo": payout,
            "approved_payout_kobo": None, "status": "PENDING_REVIEW",
            "image_paths": x.image_paths, "ecode_encrypted": encrypt(x.ecode.strip()), "notes": x.notes,
            **quote,
            # A legacy "any" rule may price either form of card. Keep the form
            # the customer actually submitted in the immutable trade snapshot.
            "submission_type": x.submission_type,
            "reason": "", "credited": False,
            "status_history": [{"status": "PENDING_REVIEW", "at": ts, "by": "customer", "note": "Submitted for review"}],
            "created_at": ts, "updated_at": ts,
        }
        await db.trades.insert_one(trade, session=session)
        await notify(user["id"], "Trade submitted",
                     f"Your {brand['name']} trade {trade['order_id']} is pending review.", "trade", trade["id"], session=session)
        return public_trade({**trade, **brand_logo_metadata(brand)})
    return await money.transaction(submit)


@api.get("/trades")
async def my_trades(status: str = "", user: dict = Depends(current_user)):
    query: dict = {"user_id": user["id"]}
    if status:
        query["status"] = status
    cur = db.trades.find(query, {"_id": 0}).sort("created_at", -1)
    trades = await cur.to_list(200)
    await attach_brand_logos(trades)
    return {"trades": [public_trade(t) for t in trades]}


@api.get("/trades/{trade_id}")
async def get_trade(trade_id: str, user: dict = Depends(current_user)):
    t = await db.trades.find_one({"id": trade_id, "user_id": user["id"]})
    if not t:
        raise HTTPException(404, "Trade not found")
    await attach_brand_logos([t])
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
        trades = await db.trades.find({"user_id": user["id"]}, {"_id": 0}).to_list(300)
        await attach_brand_logos(trades)
        for t in trades:
            amt = t.get("approved_payout_kobo") or t.get("expected_payout_kobo") or 0
            items.append({
                "currency": t.get("currency", "NGN"), "minor_digits": t.get("minor_digits", 2),
                "id": t["id"], "kind": "sale", "title": t["brand_name"], "brand_id": t["brand_id"],
                "brand_has_logo": t["brand_has_logo"], "brand_logo_version": t["brand_logo_version"],
                "subtitle": f"${t['card_value_usd']} {'E-code' if t['submission_type']=='ecode' else 'Gift Card'}",
                "amount_kobo": amt, "signed": 1, "status": _trade_status_label(t["status"]),
                "ref": t["order_id"], "color": t.get("brand_color", "#1F5AF6"),
                "date": t["created_at"], "icon": "card",
            })
    if type in ("all", "withdrawals"):
        for w in await db.withdrawals.find({"user_id": user["id"]}, {"_id": 0}).to_list(300):
            items.append({
                "currency": w.get("currency", "NGN"), "minor_digits": w.get("minor_digits", 2),
                "id": w["id"], "kind": "withdrawal", "title": "Withdrawal",
                "subtitle": f"To {w['destination']['provider_name']} ({w['destination']['account_number']})",
                "amount_kobo": w["amount_kobo"], "signed": -1, "status": _wd_status_label(w["status"]),
                "ref": w["ref"], "color": "#1F5AF6", "date": w["created_at"], "icon": "bank",
            })
    for l in await db.ledger.find({"user_id": user["id"], "type": {"$in": ["REFUND", "WITHDRAWAL_REVERSAL"]}}, {"_id": 0}).to_list(300):
        if type in ("all",):
            items.append({
                "currency": l.get("currency", user.get("currency", "NGN")), "minor_digits": user.get("minor_digits", 2),
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
    code = x.code.strip().upper()
    async def link(session):
        await money.lock_user(user["id"], session)
        full = await db.users.find_one({"id": user["id"]}, {"_id": 0, "referred_by": 1, "referral_code": 1}, session=session)
        if full.get("referred_by"):
            raise HTTPException(400, "A referral code is already linked to your account")
        if code == (full.get("referral_code") or "").upper():
            raise HTTPException(400, "You can't use your own referral code")
        referrer = await db.users.find_one({"referral_code": {"$regex": "^" + re.escape(code) + "$", "$options": "i"},
                                           "disabled": {"$ne": True}}, {"_id": 0, "id": 1, "full_name": 1}, session=session)
        if not referrer:
            raise HTTPException(400, "Referral code not found")
        await db.users.update_one({"id": user["id"]}, {"$set": {"referred_by": referrer["id"]}}, session=session)
        return {"ok": True, "referred_by_name": referrer["full_name"]}
    return await money.transaction(link)


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
    minor_digits = int(t.get("minor_digits", 2))
    unit_minor = int(t.get("unit_payout_minor") or t["rate_kobo_per_usd"] * t["card_value_usd"])
    unit_amount = Decimal(unit_minor) / (Decimal(10) ** minor_digits)
    return {
        "kind": "trade", "title": "Trade Receipt", "receipt_no": f"RCT-{t['order_id']}", "ref": t["order_id"],
        "status": "APPROVED", "verification_code": _receipt_code("trade", t["order_id"]),
        "customer": {"name": user["full_name"], "email": user["email"]},
        "issued_at": now(), "created_at": t["created_at"], "completed_at": t.get("reviewed_at") or t.get("updated_at"),
        "lines": [
            {"label": "Gift card", "value": t["brand_name"]},
            {"label": "Card value", "value": f"${t['card_value_usd']:,} × {t['quantity']}"},
            {"label": "Type", "value": "E-code" if t["submission_type"] == "ecode" else "Physical card"},
            {"label": "Payout per card", "value": f"{t.get('currency', 'NGN')} {unit_amount:,.{minor_digits}f} per card"},
        ] + ([{"label": "Reviewer note", "value": t["admin_note"]}] if t.get("admin_note") else []),
        "currency": t.get("currency", "NGN"), "minor_digits": minor_digits,
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
async def admin_tickets(status: str = "OPEN", q: str = "", admin: dict = Depends(require_staff_scope("support"))):
    query: dict = {}
    if status and status.lower() != "all":
        query["status"] = status
    if q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [{"subject": rx}, {"customer_name": rx}, {"customer_email": rx}, {"ref": rx}, {"ref_label": rx}]
    docs = await db.support_tickets.find(query, {"_id": 0}).sort("last_message_at", -1).to_list(300)
    return {"tickets": [public_ticket(t) for t in docs]}


@api.get("/admin/support/{ticket_id}")
async def admin_ticket_detail(ticket_id: str, admin: dict = Depends(require_staff_scope("support"))):
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
async def admin_reply(ticket_id: str, x: TicketMessageIn, admin: dict = Depends(require_staff_scope("support"))):
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
async def admin_ticket_status(ticket_id: str, x: TicketStatusIn, admin: dict = Depends(require_staff_scope("support"))):
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
def public_staff(u: dict) -> dict:
    return {
        "id": u["id"], "full_name": u.get("full_name", ""), "email": u["email"],
        "staff_role": staff_role(u), "staff_permissions": staff_permissions(u),
        "disabled": bool(u.get("disabled")), "created_at": u.get("created_at"),
    }


@api.get("/admin/staff")
async def admin_staff(page: int = Query(default=1, ge=1), page_size: int = Query(default=50, ge=1, le=100),
                      q: str = "", admin: dict = Depends(require_admin)):
    query: dict = {"role": "admin"}
    if staff_role(admin) == "manager":
        query["staff_role"] = "worker"
    if q.strip():
        pattern = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [{"full_name": pattern}, {"email": pattern}]
    total = await db.users.count_documents(query)
    rows = await db.users.find(query, {"_id": 0, "password_hash": 0}).sort(
        [("created_at", -1), ("id", 1)]).skip((page - 1) * page_size).to_list(page_size)
    return {"staff": [public_staff(u) for u in rows], "total": total, "page": page, "page_size": page_size}


@api.post("/admin/staff")
async def admin_create_staff(x: StaffCreateIn, admin: dict = Depends(require_admin)):
    if staff_role(admin) == "manager" and x.staff_role != "worker":
        raise HTTPException(403, "Only the General Manager can create managers")
    if not valid_admin_password(x.password):
        raise HTTPException(422, "Admin password must be 12–72 UTF-8 bytes and end with @admin")
    full_name = x.full_name.strip()
    if len(full_name) < 2:
        raise HTTPException(422, "Staff name is required")
    if x.staff_role == "manager" and x.staff_permissions:
        raise HTTPException(422, "Managers receive management access without worker scopes")
    email = str(x.email).strip().lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email already registered")
    user = {
        "id": new_id(), "full_name": full_name, "email": email, "phone": "",
        "password_hash": hash_pw(x.password), "role": "admin", "staff_role": x.staff_role,
        "staff_permissions": sorted(set(x.staff_permissions)) if x.staff_role == "worker" else [],
        "notifications_enabled": True, "disabled": False, "created_at": now(),
        "token_version": 0,
    }
    try:
        await db.users.insert_one(user)
    except DuplicateKeyError:
        raise HTTPException(409, "Email already registered")
    await production.audit(admin["id"], "staff.created", user["id"])
    return {"staff": public_staff(user)}


@api.patch("/admin/staff/{staff_id}")
async def admin_update_staff(staff_id: str, x: StaffUpdateIn, admin: dict = Depends(require_admin)):
    target = await db.users.find_one({"id": staff_id, "role": "admin"})
    if not target:
        raise HTTPException(404, "Staff account not found")
    target_role = staff_role(target)
    if target_role == "general_manager" or target["id"] == admin["id"]:
        raise HTTPException(403, "This staff account cannot be changed here")
    if staff_role(admin) == "manager" and target_role != "worker":
        raise HTTPException(403, "Managers can manage workers only")
    changes = {}
    if x.disabled is not None:
        changes["disabled"] = x.disabled
    if x.staff_permissions is not None:
        if target_role != "worker":
            raise HTTPException(422, "Worker scopes apply to workers only")
        changes["staff_permissions"] = sorted(set(x.staff_permissions))
    if x.password is not None:
        if not valid_admin_password(x.password):
            raise HTTPException(422, "Admin password must be 12–72 UTF-8 bytes and end with @admin")
        changes["password_hash"] = hash_pw(x.password)
    if not changes:
        raise HTTPException(422, "Choose a staff setting to update")
    await db.users.update_one({"id": staff_id}, {"$set": changes, "$inc": {"token_version": 1}})
    await production.audit(admin["id"], "staff.updated", staff_id)
    return {"staff": public_staff({**target, **changes})}


@api.get("/admin/stats")
async def admin_stats(admin: dict = Depends(require_staff)):
    role = staff_role(admin)
    permissions = set(staff_permissions(admin))

    def allowed(scope: str) -> bool:
        return role != "worker" or scope in permissions

    return {
        "pending_trades": await db.trades.count_documents({"status": {"$in": ["PENDING_REVIEW", "NEED_MORE_INFO"]}}) if allowed("trades") else 0,
        "pending_withdrawals": await db.withdrawals.count_documents({"status": {"$in": ["PENDING", "PROCESSING"]}}) if allowed("withdrawals") else 0,
        "total_customers": await db.users.count_documents({"role": "customer"}) if allowed("customers") else 0,
        "total_brands": await db.brands.count_documents({}) if role != "worker" else 0,
        "pending_kyc": await db.kyc_submissions.count_documents({"status": "PENDING"}) if allowed("customers") else 0,
        "open_tickets": await db.support_tickets.count_documents({"status": "OPEN"}) if allowed("support") else 0,
    }


@api.get("/admin/trades")
async def admin_trades(status: str = "", limit: int = 300, admin: dict = Depends(require_staff_scope("trades"))):
    query: dict = {}
    if status and status.lower() != "all":
        query["status"] = status
    cur = db.trades.find(query, {"_id": 0}).sort("created_at", -1)
    trades = await cur.to_list(min(max(limit, 1), 300))
    await attach_brand_logos(trades)
    # attach customer name
    for t in trades:
        u = await db.users.find_one({"id": t["user_id"]}, {"_id": 0, "full_name": 1, "email": 1})
        t["customer_name"] = u.get("full_name", "") if u else ""
        t["customer_email"] = u.get("email", "") if u else ""
        if t.get("ecode"):
            t["ecode_masked"] = ("•" * max(0, len(t["ecode"]) - 4)) + t["ecode"][-4:]
    return {"trades": trades}


@api.get("/admin/trades/{trade_id}")
async def admin_trade_detail(trade_id: str, admin: dict = Depends(require_staff_scope("trades"))):
    t = await db.trades.find_one({"id": trade_id}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Trade not found")
    await attach_brand_logos([t])
    u = await db.users.find_one({"id": t["user_id"]}, {"_id": 0, "password_hash": 0})
    t["customer"] = public_user(u) if u else None
    t["ecode"] = decrypt(t.pop("ecode_encrypted", "")) or t.get("ecode", "")
    await production.audit(admin["id"], "trade.sensitive_access", trade_id)
    return t


@api.post("/admin/trades/{trade_id}/approve")
async def admin_approve(trade_id: str, x: AdminApproveIn, admin: dict = Depends(require_staff_scope("trades"))):
    return await money.review(trade_id, "APPROVED", admin, x.approved_amount_kobo, x.note)

@api.post("/admin/trades/{trade_id}/reject")
async def admin_reject(trade_id: str, x: AdminReasonIn, admin: dict = Depends(require_staff_scope("trades"))):
    return await money.review(trade_id, "REJECTED", admin, note=x.reason)

@api.post("/admin/trades/{trade_id}/need-info")
async def admin_need_info(trade_id: str, x: AdminReasonIn, admin: dict = Depends(require_staff_scope("trades"))):
    return await money.review(trade_id, "NEED_MORE_INFO", admin, note=x.reason)


@api.get("/admin/withdrawals")
async def admin_withdrawals(status: str = "", admin: dict = Depends(require_staff_scope("withdrawals"))):
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
async def admin_wd_paid(withdrawal_id: str, x: ManualPaidIn, admin: dict = Depends(require_staff_scope("withdrawals"))):
    return await money.settle(withdrawal_id, "PAID", admin["id"], "Company payment reference: " + x.external_reference, external_reference=x.external_reference)

@api.post("/admin/withdrawals/{withdrawal_id}/reject")
async def admin_wd_reject(withdrawal_id: str, x: AdminReasonIn, admin: dict = Depends(require_staff_scope("withdrawals"))):
    return await money.settle(withdrawal_id, "REJECTED", admin["id"], x.reason)


@api.get("/admin/brands")
async def admin_brands(admin: dict = Depends(require_admin)):
    cur = db.brands.find({}, {"_id": 0}).sort("sort_order", 1)
    tradable = await tradable_brand_ids()
    return {"brands": [brand_response(b, tradable=b.get("is_active", False) and b["id"] in tradable
                       and bool(b.get("submission_types", ["physical", "ecode"])))
                       for b in await cur.to_list(300)]}


async def _popular_admin_row(row: dict, tradable_ids: set[str]) -> dict:
    brand = await db.brands.find_one({"id": row["brand_id"]}, {"_id": 0})
    if not brand:
        return {**row, "brand": None, "headline_rates": [], "bonus_market": None}
    active_market_codes = set(await db.markets.distinct("code", {"is_active": True}))
    headlines = await db.headline_rates.find({
        "brand_id": row["brand_id"], "is_active": True,
        "market_code": {"$in": sorted(active_market_codes)},
    }, {"_id": 0}).sort("market_code", 1).to_list(50)
    bonus_market = None
    if row.get("bonus_market_code"):
        bonus_market = await db.markets.find_one({"code": row["bonus_market_code"]}, {"_id": 0})
    return {
        **{k: v for k, v in row.items() if k != "_id"},
        "brand": brand_response(brand, tradable=brand.get("is_active", False) and brand["id"] in tradable_ids),
        "headline_rates": headlines,
        "bonus_market": bonus_market,
    }


@api.get("/admin/popular-cards")
async def admin_popular_cards(admin: dict = Depends(require_admin)):
    rows = await db.popular_cards.find({}, {"_id": 0}).sort("position", 1).to_list(8)
    tradable = await tradable_brand_ids()
    return {"popular_cards": [await _popular_admin_row(row, tradable) for row in rows], "max_items": 8}


@api.post("/admin/popular-cards")
async def admin_add_popular_card(x: PopularCardAddIn, admin: dict = Depends(require_admin)):
    brand = await db.brands.find_one({"id": x.brand_id})
    if not brand or brand.get("archived_at"):
        raise HTTPException(404, "Catalog card not found")
    if not brand.get("is_active"):
        raise HTTPException(409, "Activate this catalog card before adding it to Popular Gift Cards")
    active_markets = set(await db.markets.distinct("code", {"is_active": True}))
    detailed_markets = set(await db.detailed_rates.distinct("market_code", {
        "brand_id": x.brand_id, "market_code": {"$in": sorted(active_markets)},
        "is_active": True, "archived_at": None,
        "submission_type": {"$in": brand.get("submission_types") or ["physical", "ecode"]},
        "rate_minor_per_unit": {"$gt": 0},
    }))
    if not detailed_markets:
        raise HTTPException(409, "Set an active trading rate for this card before adding it to Popular Gift Cards")
    headline = await db.headline_rates.find_one({
        "brand_id": x.brand_id, "is_active": True, "archived_at": None,
        "rate_minor_per_unit": {"$gt": 0},
        "market_code": {"$in": sorted(detailed_markets)},
    })
    if not headline:
        raise HTTPException(409, "Set an active headline/display rate in the same market as its trading rate")

    async def add(session):
        existing = await db.popular_cards.find_one({"brand_id": x.brand_id}, session=session, for_update=True)
        if existing:
            return existing
        cursor = db.popular_cards.find({}, session=session).sort("position", 1)
        cursor.for_update = True
        current = await cursor.to_list(8)
        if len(current) >= 8:
            raise HTTPException(409, "Popular Gift Cards can contain at most 8 cards")
        row = {
            "_id": "popular_" + x.brand_id,
            "brand_id": x.brand_id,
            "position": len(current) + 1,
            "bonus_enabled": False,
            "bonus_market_code": None,
            "bonus_amount_minor": None,
            "min_card_value_usd": None,
            "created_at": now(),
            "updated_at": now(),
        }
        try:
            await db.popular_cards.insert_one(row, session=session)
        except DuplicateKeyError as exc:
            raise HTTPException(409, "Popular Gift Cards changed at the same time. Refresh and try again") from exc
        await db.brands.update_one({"id": x.brand_id}, {"$set": {"is_popular": True}}, session=session)
        await db.audit.insert_one({"actor": admin["id"], "action": "popular_card.added", "target": x.brand_id, "at": now()}, session=session)
        return row

    row = await db.transaction(add)
    return await _popular_admin_row(row, await tradable_brand_ids())


@api.patch("/admin/popular-cards/{brand_id}")
async def admin_update_popular_card(brand_id: str, x: PopularCardBonusIn, admin: dict = Depends(require_admin)):
    row = await db.popular_cards.find_one({"brand_id": brand_id})
    if not row:
        raise HTTPException(404, "Popular card not found")
    market_code = (x.bonus_market_code or "").strip().upper() or None
    if x.bonus_enabled:
        if not market_code or x.bonus_amount_minor is None:
            raise HTTPException(422, "Choose an active bonus currency and enter a bonus amount")
        market = await db.markets.find_one({"code": market_code, "is_active": True})
        if not market:
            raise HTTPException(422, "Choose a currency from an active market")
    elif market_code and not await db.markets.find_one({"code": market_code, "is_active": True}):
        raise HTTPException(422, "Choose a currency from an active market")
    changes = {
        "bonus_enabled": x.bonus_enabled,
        "bonus_market_code": market_code,
        "bonus_amount_minor": x.bonus_amount_minor,
        "min_card_value_usd": x.min_card_value_usd,
        "updated_at": now(),
    }
    await db.popular_cards.update_one({"brand_id": brand_id}, {"$set": changes})
    await db.audit.insert_one({"actor": admin["id"], "action": "popular_card.updated", "target": brand_id, "at": now()})
    saved = await db.popular_cards.find_one({"brand_id": brand_id}, {"_id": 0})
    return await _popular_admin_row(saved, await tradable_brand_ids())


@api.post("/admin/popular-cards/reorder")
async def admin_reorder_popular_cards(x: PopularCardReorderIn, admin: dict = Depends(require_admin)):
    if len(set(x.brand_ids)) != len(x.brand_ids):
        raise HTTPException(422, "Popular card order cannot contain duplicates")

    async def reorder(session):
        cursor = db.popular_cards.find({}, session=session).sort("position", 1)
        cursor.for_update = True
        current = await cursor.to_list(8)
        current_ids = [row["brand_id"] for row in current]
        if set(current_ids) != set(x.brand_ids) or len(current_ids) != len(x.brand_ids):
            raise HTTPException(409, "Popular Gift Cards changed. Refresh before reordering")
        if len(current_ids) > 8:
            raise HTTPException(409, "Popular Gift Cards can contain at most 8 cards")
        if not current_ids:
            return
        by_brand = {row["brand_id"]: row for row in current}
        await db.popular_cards.delete_many({}, session=session)
        for position, item_brand_id in enumerate(x.brand_ids, start=1):
            row = dict(by_brand[item_brand_id])
            row.pop("_id", None)
            row["_id"] = "popular_" + item_brand_id
            row["position"] = position
            row["updated_at"] = now()
            await db.popular_cards.insert_one(row, session=session)
        await db.audit.insert_one({"actor": admin["id"], "action": "popular_cards.reordered", "target": ",".join(x.brand_ids), "at": now()}, session=session)

    await db.transaction(reorder)
    return await admin_popular_cards(admin)


@api.delete("/admin/popular-cards/{brand_id}")
async def admin_remove_popular_card(brand_id: str, admin: dict = Depends(require_admin)):
    async def remove(session):
        if not await _remove_popular_membership(brand_id, session):
            raise HTTPException(404, "Popular card not found")
        await db.audit.insert_one({"actor": admin["id"], "action": "popular_card.removed", "target": brand_id, "at": now()}, session=session)
    await db.transaction(remove)
    return {"ok": True}


@api.post("/admin/brands")
async def admin_create_brand(x: BrandIn, admin: dict = Depends(require_admin)):
    count = await db.brands.count_documents({})
    payload = x.model_dump()
    # Popular membership is managed only through /admin/popular-cards so the
    # collection order, max-8 rule and bonus settings cannot drift.
    payload["is_popular"] = False
    b = {"id": new_id(), "slug": x.name.lower().replace(" ", "-"), "sort_order": count + 1,
         "created_at": now(), **payload}
    await db.brands.insert_one(b)
    return brand_response(b, tradable=False)


@api.patch("/admin/brands/{brand_id}")
async def admin_update_brand(brand_id: str, x: BrandIn, admin: dict = Depends(require_admin)):
    old = await db.brands.find_one({"id": brand_id})
    if not old:
        raise HTTPException(404, "Brand not found")
    payload = x.model_dump()
    payload["is_popular"] = bool(await db.popular_cards.find_one({"brand_id": brand_id}))
    changes: dict = {"$set": payload}
    # Explicitly re-activating an archived catalog card restores it to normal
    # management state. It still remains invisible to customers until a usable
    # active rate exists.
    if x.is_active and old.get("archived_at"):
        changes["$unset"] = {"archived_at": ""}
    await db.brands.update_one({"id": brand_id}, changes)
    if old.get("rate_kobo_per_usd") != x.rate_kobo_per_usd:
        await db.rate_changes.insert_one({
            "id": new_id(), "brand_id": brand_id, "brand_name": x.name, "old": old.get("rate_kobo_per_usd"),
            "new": x.rate_kobo_per_usd, "by": admin["id"], "by_name": admin["full_name"], "at": now(),
        })
    saved = await db.brands.find_one({"id": brand_id}, {"_id": 0})
    return brand_response(saved, tradable=saved["is_active"] and brand_id in await tradable_brand_ids())


async def _remove_popular_membership(brand_id: str, session) -> bool:
    row = await db.popular_cards.find_one({"brand_id": brand_id}, session=session, for_update=True)
    if not row:
        return False
    removed_position = int(row["position"])
    await db.popular_cards.delete_many({"brand_id": brand_id}, session=session)
    await db.brands.update_one({"id": brand_id}, {"$set": {"is_popular": False}}, session=session)
    later = db.popular_cards.find({"position": {"$gt": removed_position}}, session=session).sort("position", 1)
    later.for_update = True
    for item in await later.to_list(8):
        await db.popular_cards.update_one({"brand_id": item["brand_id"]}, {"$set": {"position": int(item["position"]) - 1, "updated_at": now()}}, session=session)
    return True


@api.delete("/admin/brands/{brand_id}")
async def admin_delete_or_archive_brand(brand_id: str, admin: dict = Depends(require_admin)):
    brand = await db.brands.find_one({"id": brand_id})
    if not brand:
        raise HTTPException(404, "Brand not found")
    historical_trades = await db.trades.count_documents({"brand_id": brand_id})
    if historical_trades:
        async def archive(session):
            archived_at = now()
            await _remove_popular_membership(brand_id, session)
            await db.brands.update_one({"id": brand_id}, {"$set": {
                "is_active": False, "is_popular": False, "archived_at": archived_at,
            }}, session=session)
            await db.card_rates.update_many({"brand_id": brand_id, "is_active": True}, {"$set": {
                "is_active": False, "archived_at": archived_at,
            }}, session=session)
            await db.headline_rates.update_many({"brand_id": brand_id, "is_active": True}, {"$set": {
                "is_active": False, "archived_at": archived_at, "updated_at": archived_at,
            }}, session=session)
            await db.detailed_rates.update_many({"brand_id": brand_id, "is_active": True}, {"$set": {
                "is_active": False, "archived_at": archived_at, "updated_at": archived_at,
            }}, session=session)
            await db.audit.insert_one({"actor": admin["id"], "action": "brand.archived",
                "target": brand_id, "at": archived_at}, session=session)
        await db.transaction(archive)
        saved = await db.brands.find_one({"id": brand_id}, {"_id": 0})
        return {"ok": True, "deleted": False, "archived": True,
                "brand": brand_response(saved, tradable=False)}

    async def remove(session):
        await _remove_popular_membership(brand_id, session)
        await db.card_rates.delete_many({"brand_id": brand_id}, session=session)
        await db.headline_rates.delete_many({"brand_id": brand_id}, session=session)
        await db.detailed_rates.delete_many({"brand_id": brand_id}, session=session)
        await db.rate_changes.delete_many({"brand_id": brand_id}, session=session)
        await db.brands.delete_many({"id": brand_id}, session=session)
        await db.audit.insert_one({"actor": admin["id"], "action": "brand.deleted",
            "target": brand_id, "at": now()}, session=session)
    await db.transaction(remove)
    return {"ok": True, "deleted": True, "archived": False}


@api.delete("/admin/brands/{brand_id}/logo")
async def admin_remove_brand_logo(brand_id: str, admin: dict = Depends(require_admin)):
    brand = await db.brands.find_one({"id": brand_id})
    if not brand:
        raise HTTPException(404, "Brand not found")
    async def remove(session):
        await db.brands.update_one({"id": brand_id}, {"$unset": {"logo_path": ""}}, session=session)
        await db.audit.insert_one({"actor": admin["id"], "action": "brand.logo.removed",
                                   "target": brand_id, "at": now()}, session=session)
    await db.transaction(remove)
    updated = await db.brands.find_one({"id": brand_id}, {"_id": 0})
    return brand_response(updated, tradable=updated["is_active"] and brand_id in await tradable_brand_ids())


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
async def admin_users(q: str = "", kyc: str = "", admin: dict = Depends(require_staff_scope("customers"))):
    query: dict = {"role": "customer"} if staff_role(admin) == "worker" else {}
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
async def admin_user_detail(user_id: str, admin: dict = Depends(require_staff_scope("customers"))):
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not u or (staff_role(admin) == "worker" and u.get("role") != "customer"):
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
async def admin_kyc_list(status: str = "PENDING", admin: dict = Depends(require_staff_scope("customers"))):
    query: dict = {}
    if status and status.lower() != "all":
        query["status"] = status
    docs = await db.kyc_submissions.find(query, {"_id": 0}).sort("created_at", 1 if status == "PENDING" else -1).to_list(300)
    await _attach_customer(docs)
    return {"submissions": [public_kyc(d) for d in docs]}


@api.get("/admin/kyc/{kyc_id}")
async def admin_kyc_detail(kyc_id: str, admin: dict = Depends(require_staff_scope("customers"))):
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
async def admin_kyc_approve(kyc_id: str, admin: dict = Depends(require_staff_scope("customers"))):
    k = await _review_kyc(kyc_id, admin, "VERIFIED", "")
    await notify(k["user_id"], "Identity verified",
                 "Your identity verification has been approved.", "kyc", kyc_id)
    return {"ok": True}


@api.post("/admin/kyc/{kyc_id}/reject")
async def admin_kyc_reject(kyc_id: str, x: AdminReasonIn, admin: dict = Depends(require_staff_scope("customers"))):
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
    """Compatibility name for scripts: verify applied SQL migrations, never run DDL."""
    await db.check_schema()


@app.on_event("startup")
async def on_start():
    await db.check_schema()
    if IS_PRODUCTION:
        encrypt("configuration-check")
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
from upload_transport import router as upload_router
app.include_router(upload_router(sys.modules[__name__]))
app.include_router(production.router())
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges"],
)


@app.on_event("shutdown")
async def shutdown():
    await db.close()

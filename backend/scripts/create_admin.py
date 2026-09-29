"""Create the one Bring Gift Card General Manager explicitly.

No admin account is created automatically at API startup.
Provide credentials through CLI flags or BGC_ADMIN_* environment variables.
"""
import argparse
import asyncio
import getpass
import os
import uuid
from pathlib import Path
from dotenv import load_dotenv
from datetime import datetime, timezone

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from persistence import Database, DuplicateKeyError
from passlib.context import CryptContext

pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def now():
    return datetime.now(timezone.utc)


def args():
    p = argparse.ArgumentParser()
    p.add_argument("--email", default=os.environ.get("BGC_ADMIN_EMAIL", ""))
    p.add_argument("--name", default=os.environ.get("BGC_ADMIN_NAME", "Bring Gift Card General Manager"))
    p.add_argument("--phone", default=os.environ.get("BGC_ADMIN_PHONE", ""))
    p.add_argument("--country", default=os.environ.get("BGC_ADMIN_COUNTRY", ""))
    p.add_argument("--password", default=os.environ.get("BGC_ADMIN_PASSWORD", ""))
    return p.parse_args()


async def main():
    cfg = args()
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        raise SystemExit("DATABASE_URL is required")

    email = cfg.email.strip().lower()
    if not email:
        raise SystemExit("Admin email is required (--email or BGC_ADMIN_EMAIL)")
    password = cfg.password or getpass.getpass("Admin password: ")
    if not password.endswith("@admin") or len(password) < 12 or len(password.encode("utf-8")) > 72:
        raise SystemExit("Admin password must end with @admin, be at least 12 characters, and fit within 72 UTF-8 bytes")

    db = Database(database_url, os.environ.get("DATABASE_SCHEMA", "public"))
    await db.check_schema()
    try:
        existing = await db.users.find_one({"email": email})
        if existing:
            raise SystemExit("A user with that email already exists; no changes made")
        if await db.users.find_one({"staff_role": "general_manager"}):
            raise SystemExit("A General Manager already exists; no changes made")
        try:
            await db.users.insert_one({
            "id": uuid.uuid4().hex,
            "full_name": cfg.name.strip() or "Bring Gift Card General Manager",
            "email": email,
            "phone": cfg.phone.strip(),
            "password_hash": pwd.hash(password),
            "role": "admin",
            "staff_role": "general_manager",
            "staff_permissions": [],
            "country": cfg.country.strip(),
            "kyc_status": "unverified",
            "notifications_enabled": True,
            "disabled": False,
            "referral_code": "BGC" + uuid.uuid4().hex[:8].upper(),
            "created_at": now(),
            "token_version": 0,
            })
        except DuplicateKeyError:
            raise SystemExit("Email or General Manager account already exists; no changes made")
        print(f"Created General Manager: {email}")
    finally:
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())

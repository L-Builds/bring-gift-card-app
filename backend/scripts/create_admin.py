"""Create the first Bring Gift Card admin explicitly.

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

from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext

pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def now():
    return datetime.now(timezone.utc)


def args():
    p = argparse.ArgumentParser()
    p.add_argument("--email", default=os.environ.get("BGC_ADMIN_EMAIL", ""))
    p.add_argument("--name", default=os.environ.get("BGC_ADMIN_NAME", "Bring Gift Card Admin"))
    p.add_argument("--phone", default=os.environ.get("BGC_ADMIN_PHONE", ""))
    p.add_argument("--country", default=os.environ.get("BGC_ADMIN_COUNTRY", ""))
    p.add_argument("--password", default=os.environ.get("BGC_ADMIN_PASSWORD", ""))
    return p.parse_args()


async def main():
    cfg = args()
    mongo_url = os.environ.get("MONGO_URL", "").strip()
    db_name = os.environ.get("DB_NAME", "").strip()
    if not mongo_url or not db_name:
        raise SystemExit("MONGO_URL and DB_NAME are required")

    email = cfg.email.strip().lower()
    if not email:
        raise SystemExit("Admin email is required (--email or BGC_ADMIN_EMAIL)")
    password = cfg.password or getpass.getpass("Admin password: ")
    if len(password) < 12 or len(password.encode("utf-8")) > 72:
        raise SystemExit("Admin password must be at least 12 characters and at most 72 UTF-8 bytes")

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    try:
        existing = await db.users.find_one({"email": email})
        if existing:
            raise SystemExit("A user with that email already exists; no changes made")
        await db.users.insert_one({
            "id": uuid.uuid4().hex,
            "full_name": cfg.name.strip() or "Bring Gift Card Admin",
            "email": email,
            "phone": cfg.phone.strip(),
            "password_hash": pwd.hash(password),
            "role": "admin",
            "country": cfg.country.strip(),
            "kyc_status": "unverified",
            "notifications_enabled": True,
            "disabled": False,
            "referral_code": "BGC" + uuid.uuid4().hex[:8].upper(),
            "created_at": now(),
        })
        print(f"Created admin: {email}")
    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(main())

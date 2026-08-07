"""Bootstrap the Oromona platform admin account.

Credentials come ONLY from the environment (backend/.env):
    ADMIN_SEED_EMAIL     — admin login email (default admin@oromona.com)
    ADMIN_SEED_PASSWORD  — REQUIRED; the script aborts if unset so no
                           predictable password can ever ship in source.

Re-running is idempotent: an existing admin is refreshed (role restored,
un-suspended, password re-hashed from the env value). No demo sellers or
starter catalog are seeded — the marketplace starts clean.
"""

import asyncio
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import bcrypt
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

ADMIN_EMAIL = os.environ.get("ADMIN_SEED_EMAIL", "admin@oromona.com").strip().lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_SEED_PASSWORD", "")
ADMIN_FULL_NAME = "Oromona Platform Admin"


async def main() -> None:
    if not ADMIN_PASSWORD:
        raise SystemExit(
            "ADMIN_SEED_PASSWORD is not set — add it to backend/.env before seeding."
        )

    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    hashed = bcrypt.hashpw(ADMIN_PASSWORD.encode(), bcrypt.gensalt()).decode()
    existing = await db.users.find_one({"email": ADMIN_EMAIL})
    if existing:
        await db.users.update_one(
            {"id": existing["id"]},
            {
                "$set": {
                    "role": "admin",
                    "suspended": False,
                    "full_name": ADMIN_FULL_NAME,
                    "hashed_password": hashed,
                }
            },
        )
        print(f"  · admin refreshed ({ADMIN_EMAIL})")
    else:
        await db.users.insert_one(
            {
                "id": str(uuid.uuid4()),
                "email": ADMIN_EMAIL,
                "full_name": ADMIN_FULL_NAME,
                "role": "admin",
                "hashed_password": hashed,
                "suspended": False,
                "created_at": datetime.now(timezone.utc),
            }
        )
        print(f"  + seeded admin {ADMIN_EMAIL}")

    print("Done.")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())

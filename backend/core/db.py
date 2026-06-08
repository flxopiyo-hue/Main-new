"""MongoDB client singleton."""

from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from .config import DB_NAME, MONGO_URL

mongo_client: AsyncIOMotorClient = AsyncIOMotorClient(MONGO_URL)
db: AsyncIOMotorDatabase = mongo_client[DB_NAME]


def close_db() -> None:
    mongo_client.close()

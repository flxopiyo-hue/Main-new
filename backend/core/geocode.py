"""Keyless, cached city/country → approximate coordinates.

Uses the public OpenStreetMap Nominatim service (no API key). Per OSM
policy we send an identifying User-Agent, keep volume tiny (only when an
order goes out for delivery), and CACHE every result — including misses —
in the ``geo_cache`` collection so an unchanged city is never looked up
twice. Returns only a city-centre-level point, never a precise address.

Best-effort: any failure returns ``None`` and the map is simply hidden.
"""

from __future__ import annotations

import logging
from typing import Dict, Optional

import httpx

from core.db import db

logger = logging.getLogger("oromona.geocode")

_NOMINATIM = "https://nominatim.openstreetmap.org/search"
_UA = "Oromona/1.0 (+https://oromona.com; support@oromona.com)"


def _key(city: str, country: str) -> str:
    return f"{city.strip().lower()}|{country.strip().lower()}"


async def approx_location(
    city: Optional[str], country: Optional[str]
) -> Optional[Dict[str, float]]:
    """Return ``{"lat": .., "lon": ..}`` for a city/country, or ``None``."""
    if not city or not country:
        return None
    key = _key(city, country)
    cached = await db.geo_cache.find_one(
        {"key": key}, {"_id": 0, "lat": 1, "lon": 1, "miss": 1}
    )
    if cached is not None:
        if cached.get("miss"):
            return None
        return {"lat": cached["lat"], "lon": cached["lon"]}

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(
                _NOMINATIM,
                params={"q": f"{city}, {country}", "format": "jsonv2", "limit": 1},
                headers={"User-Agent": _UA, "Accept": "application/json"},
            )
        rows = resp.json() if resp.status_code == 200 else []
    except Exception as e:  # pragma: no cover — best effort
        logger.warning("geocode failed for %s: %s", key, e)
        return None

    if not rows:
        await db.geo_cache.update_one(
            {"key": key}, {"$set": {"key": key, "miss": True}}, upsert=True
        )
        return None

    try:
        lat = float(rows[0]["lat"])
        lon = float(rows[0]["lon"])
    except (KeyError, ValueError, TypeError):
        return None

    await db.geo_cache.update_one(
        {"key": key}, {"$set": {"key": key, "lat": lat, "lon": lon}}, upsert=True
    )
    return {"lat": lat, "lon": lon}

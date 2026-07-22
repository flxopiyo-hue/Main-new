"""Carrier auto-detection from a tracking URL.

Sellers paste whichever tracking URL their courier gave them. We look
at the hostname and heuristically map it to a display name + logo hint.

This is intentionally regex/hostname based rather than "call the
carrier's API" — apparel marketplaces in Kenya/EA use dozens of small
courier companies, most of whom have no public API. Auto-detect just
lets us paint a nicer carrier badge in the UI. If we can't match, we
fall back to "External carrier".
"""

from __future__ import annotations

import re
from typing import Dict, Optional
from urllib.parse import urlparse

# Ordered from most specific to least specific hostname pattern.
# Each entry: (regex against hostname or full url, carrier display name).
_CARRIER_MATCHERS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"g4s(?:tracking|courier)?\.", re.I), "G4S Courier"),
    (re.compile(r"sendyit\.com|sendy\.co\.ke|sendy\.", re.I), "Sendy"),
    (re.compile(r"fargocourier\.co\.ke|fargo\.co\.ke", re.I), "Fargo Courier"),
    (re.compile(r"wellsfargo(?:kenya|courier)?\.co\.ke", re.I), "Wells Fargo Courier"),
    (re.compile(r"speed[- ]?af\.com|speedaf\.", re.I), "Speed-AF"),
    (re.compile(r"pickupmtaani\.|mtaanicourier\.", re.I), "Pickup Mtaani"),
    (re.compile(r"posta\.co\.ke|emsposta\.|ems\.", re.I), "EMS Kenya (Posta)"),
    (re.compile(r"dhl\.", re.I), "DHL"),
    (re.compile(r"fedex\.", re.I), "FedEx"),
    (re.compile(r"ups\.", re.I), "UPS"),
    (re.compile(r"aramex\.", re.I), "Aramex"),
    (re.compile(r"yego(?:courier|movers)?\.", re.I), "Yego"),
    (re.compile(r"glovoapp\.com|glovo\.", re.I), "Glovo"),
    (re.compile(r"bolt\.eu|bolt\.food|bolt\.", re.I), "Bolt"),
    (re.compile(r"uber(?:direct|freight)?\.", re.I), "Uber"),
    (re.compile(r"lynk\.co\.ke", re.I), "Lynk"),
    (re.compile(r"skynetworldwide\.|skynet\.", re.I), "SkyNet"),
    (re.compile(r"ndhl\.co\.ke|nairobicourier\.", re.I), "Nairobi Courier"),
    (re.compile(r"pika\.co\.ke", re.I), "PIKA"),
    (re.compile(r"safeboda\.", re.I), "SafeBoda"),
    (re.compile(r"jumia(?:express|services)?\.", re.I), "Jumia Express"),
]


def detect_carrier(tracking_url: Optional[str]) -> Optional[str]:
    """Return a friendly carrier name or ``None`` when the URL is
    missing/unparseable. Uses the hostname first, then falls back to a
    full-URL scan so query-string branding still matches.
    """
    if not tracking_url:
        return None
    url = tracking_url.strip()
    if not url:
        return None
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        host = ""
    haystack = f"{host} {url}"
    for pattern, name in _CARRIER_MATCHERS:
        if pattern.search(haystack):
            return name
    return "External carrier"


def enrich_order_with_carrier(order_doc: Dict[str, object]) -> Dict[str, object]:
    """Compute ``carrier`` on the fly (non-persistent) if the doc has a
    ``tracking_url`` but no ``carrier`` field yet. Cheap enough to run
    on every read; a startup migration back-fills the persisted value
    over time.
    """
    if order_doc.get("carrier") is None and order_doc.get("tracking_url"):
        c = detect_carrier(order_doc.get("tracking_url"))  # type: ignore[arg-type]
        if c:
            order_doc["carrier"] = c
    return order_doc

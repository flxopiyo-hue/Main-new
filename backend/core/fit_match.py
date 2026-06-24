"""Fit Match Score — compares an item's per-size dimensions to a buyer's
body profile measurements and returns a 0-100 score plus the best-fitting
size and a per-dimension breakdown that the UI uses for narration.

Algorithm (kept deliberately simple & explainable):

  For each (size, dimension):
    diff = garment[dim] - body[dim]   # +ve = roomy, -ve = snug
    distance = abs(diff)
    points = max(0, 100 - distance * sensitivity[dim])

  Each size's score is the average of its per-dimension `points`.
  The item's headline score is the BEST size's score.

`sensitivity` is the points-lost per centimetre of mismatch. We deliberately
tune chest/waist/hip looser than shoulder/sleeve/inseam because a 2cm
mismatch around the torso is usually fine while the same gap on a shoulder
is structurally bad.

We also surface the *diff* per dimension so the UI can render narration:
  diff > +5   → "Very roomy"
  +2 < diff   → "Roomy"
  -2 ≤ diff ≤ 2 → "Perfect"
  diff < -2   → "Snug"
  diff < -5   → "Very tight"
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

# Points lost per centimetre of mismatch, per dimension. Higher = the
# algorithm punishes mismatches more aggressively (so the dimension feels
# "more important"). All values are tuned against typical clothing fits.
_SENSITIVITY: Dict[str, float] = {
    # Torso (forgiving — knits & wovens stretch / drape)
    "chest_cm": 6.0,
    "bust_cm": 6.0,
    "waist_cm": 6.0,
    "hips_cm": 6.0,
    # Structure (unforgiving — shoulder seams + sleeves are visible)
    "shoulder_cm": 12.0,
    "sleeve_cm": 8.0,
    # Length / depth (medium — buyers tolerate a few cm here)
    "length_cm": 6.0,
    "inseam_cm": 8.0,
    "rise_cm": 10.0,
}

# Dimension keys we consider for each garment type (mirrors the seller
# upload form). Keys not in this list are ignored even if present.
_KEYS_BY_GARMENT_TYPE: Dict[str, List[str]] = {
    "shirt": ["chest_cm", "shoulder_cm", "sleeve_cm", "length_cm"],
    "outerwear": ["chest_cm", "shoulder_cm", "sleeve_cm", "length_cm"],
    "dress": ["bust_cm", "waist_cm", "hips_cm", "length_cm"],
    "trousers": ["waist_cm", "hips_cm", "inseam_cm", "rise_cm"],
    "shoes": [],
    "other": [],
}


def _body_value(body: Dict[str, Any], key: str) -> Optional[float]:
    """Pull the matching value off the buyer's `Measurements` dict.

    The body profile uses slightly different naming for a couple of fields
    (e.g. body has `shoulders_cm`, items have `shoulder_cm`). This helper
    encapsulates the aliasing so the rest of the algorithm stays clean.
    """
    aliases = {
        "shoulder_cm": ["shoulders_cm", "shoulder_cm"],
        "bust_cm": ["chest_cm", "bust_cm"],  # buyer profile uses chest_cm for everyone
    }
    for k in aliases.get(key, [key]):
        v = body.get(k)
        if isinstance(v, (int, float)) and v > 0:
            return float(v)
    return None


def _dimension_label(diff: float) -> str:
    """Human-readable phrase used by the slider narration."""
    if diff <= -5:
        return "very tight"
    if diff <= -2:
        return "snug"
    if diff < 2:
        return "perfect"
    if diff < 5:
        return "roomy"
    return "very roomy"


def _score_color(score: float) -> str:
    if score >= 75:
        return "green"
    if score >= 50:
        return "amber"
    return "red"


def _label(key: str) -> str:
    """Pretty label for narration ("chest", "shoulder", ...)."""
    return key.replace("_cm", "").replace("_", " ")


def compute_fit(item: Dict[str, Any], body: Dict[str, Any]) -> Dict[str, Any]:
    """Public entry point. Returns a dict shaped for the API response.

    item — raw item document (must contain `garment_type` and `sizes`).
    body — buyer's `Measurements` dict (height_cm, chest_cm, etc.).
    """
    gtype = item.get("garment_type") or "other"
    keys = _KEYS_BY_GARMENT_TYPE.get(gtype, [])
    sizes = item.get("sizes", []) or []

    # When we can't meaningfully score (no body-fit dimensions for this
    # garment type, no body profile, or no per-size dimensions on the item)
    # we still respond with a normalized envelope so the client never has
    # to special-case None responses.
    if not keys or not sizes:
        return {
            "scorable": False,
            "reason": (
                "Body-fit measurements aren't applicable for this garment"
                if not keys
                else "This item has no per-size dimensions yet"
            ),
            "score": None,
            "color": None,
            "recommended_size": None,
            "per_size": [],
        }

    # Check at least one body dimension is present for ANY size's keys.
    has_any_body_value = any(_body_value(body, k) is not None for k in keys)
    if not has_any_body_value:
        return {
            "scorable": False,
            "reason": "Add your body measurements in Profile to see your fit",
            "score": None,
            "color": None,
            "recommended_size": None,
            "per_size": [],
        }

    per_size: List[Dict[str, Any]] = []
    for s in sizes:
        per_dim: List[Dict[str, Any]] = []
        score_parts: List[float] = []
        for k in keys:
            garment_v = s.get(k)
            body_v = _body_value(body, k)
            if garment_v is None or body_v is None:
                # Neutral entry — still surfaced in the response so the UI
                # can label it "—" or omit; doesn't influence the score.
                per_dim.append(
                    {
                        "key": k,
                        "label": _label(k),
                        "garment": garment_v,
                        "body": body_v,
                        "diff": None,
                        "narrative": None,
                    }
                )
                continue
            diff = round(float(garment_v) - float(body_v), 1)
            sensitivity = _SENSITIVITY.get(k, 6.0)
            points = max(0.0, 100.0 - abs(diff) * sensitivity)
            score_parts.append(points)
            per_dim.append(
                {
                    "key": k,
                    "label": _label(k),
                    "garment": float(garment_v),
                    "body": float(body_v),
                    "diff": diff,
                    "narrative": f"{_dimension_label(diff)} {_label(k)}",
                }
            )

        size_score: Optional[float]
        if score_parts:
            size_score = round(sum(score_parts) / len(score_parts), 1)
        else:
            size_score = None
        per_size.append(
            {
                "label": s.get("label"),
                "available_qty": int(s.get("available_qty", 0)),
                "score": size_score,
                "dimensions": per_dim,
            }
        )

    # Pick the recommended size = highest score with available_qty > 0,
    # falling back to highest score overall if everything is out of stock.
    scored = [p for p in per_size if p["score"] is not None]
    in_stock = [p for p in scored if p["available_qty"] > 0]
    candidates = in_stock if in_stock else scored
    best = max(candidates, key=lambda p: p["score"]) if candidates else None

    if not best:
        return {
            "scorable": False,
            "reason": "Item dimensions missing — ask the seller to update sizes",
            "score": None,
            "color": None,
            "recommended_size": None,
            "per_size": per_size,
        }

    headline = float(best["score"])
    return {
        "scorable": True,
        "score": headline,
        "color": _score_color(headline),
        "recommended_size": best["label"],
        "per_size": per_size,
    }

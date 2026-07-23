"""Environment-driven configuration for the AuraFit backend.

Every value here is loaded once at import time. Never modify the .env files —
the Kubernetes ingress + Expo proxy contract relies on them.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

# ---- Required env vars (raise on missing) --------------------------------
MONGO_URL: str = os.environ["MONGO_URL"]
DB_NAME: str = os.environ["DB_NAME"]
JWT_SECRET: str = os.environ["JWT_SECRET"]

# ---- Optional env vars with defaults -------------------------------------
JWT_ALGORITHM: str = os.environ.get("JWT_ALGORITHM", "HS256")
JWT_EXPIRY_HOURS: int = int(os.environ.get("JWT_EXPIRY_HOURS", "168"))
EMERGENT_LLM_KEY: str = os.environ.get("EMERGENT_LLM_KEY", "")

# Paystack — used for Premium subscriptions AND for buyer→seller item
# purchases. Kenya-first payment rail with native M-Pesa + card support.
# Same secret key signs webhooks (Paystack convention — no separate
# webhook secret).
PAYSTACK_PUBLIC_KEY: str = os.environ.get("PAYSTACK_PUBLIC_KEY", "")
PAYSTACK_SECRET_KEY: str = os.environ.get("PAYSTACK_SECRET_KEY", "")
PREMIUM_PLAN_NAME: str = os.environ.get("PREMIUM_PLAN_NAME", "Oromona Premium")
PREMIUM_PLAN_AMOUNT_KOBO: int = int(os.environ.get("PREMIUM_PLAN_AMOUNT_KOBO", "19900"))
PREMIUM_PLAN_TRIAL_DAYS: int = int(os.environ.get("PREMIUM_PLAN_TRIAL_DAYS", "7"))
FRONTEND_PUBLIC_URL: str = os.environ.get(
    "FRONTEND_PUBLIC_URL", "https://fit-finder-app-5.preview.emergentagent.com"
)

# ---- Domain constants ----------------------------------------------------
NANO_BANANA_MODEL: str = "gemini-3.1-flash-image-preview"
VISION_MODEL: str = "gemini-2.5-flash"
PLATFORM_FEE_BPS: int = 1500  # 15% take rate (Paystack escrow model — released after buyer confirmation or 48h auto-release)
MAX_TRYON_ANGLES: int = 4
DEFAULT_CURRENCY: str = "KES"  # Kenyan Shilling — product originates in Kenya

# Subscription gating — Free tier caps kept intentionally generous so the
# Premium sell is "unlimited + multi-profile + AI multi-angle outfits"
# rather than "starving you until you pay".
FREE_TRYONS_PER_WEEK: int = 7
FREE_MAX_PROFILES: int = 2
PREMIUM_MAX_PROFILES: int = 10

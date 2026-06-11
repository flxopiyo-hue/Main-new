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
STRIPE_API_KEY: str = os.environ.get("STRIPE_API_KEY", "")

# ---- Domain constants ----------------------------------------------------
NANO_BANANA_MODEL: str = "gemini-3.1-flash-image-preview"
VISION_MODEL: str = "gemini-2.5-flash"
PLATFORM_FEE_BPS: int = 1000  # 10% take rate (per seller portal spec)
MAX_TRYON_ANGLES: int = 4
DEFAULT_CURRENCY: str = "KES"  # Kenyan Shilling — product originates in Kenya

CONNECT_MOCKED_NOTE: str = (
    "Demo onboarding — replace `STRIPE_API_KEY` with a real Stripe test key "
    "to enable real Stripe Connect Express accounts and live payouts."
)

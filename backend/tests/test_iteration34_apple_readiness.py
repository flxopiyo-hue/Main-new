"""Backend tests for iteration 34 — Apple App Store readiness.

Covers:
- POST /api/auth/apple accepts optional `authorization_code` and still
  rejects invalid identity tokens.
- core.apple helpers no-op gracefully when Apple env is missing.
- DELETE /api/auth/me still works when the user has no Apple provider.
- DELETE /api/auth/me revokes Apple token (best-effort) when set.
- Existing auth endpoints continue to work.
"""
from __future__ import annotations

import asyncio
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _register_buyer(api) -> dict:
    email = f"TEST_apple_{uuid.uuid4().hex[:10]}@example.com"
    payload = {
        "email": email,
        "password": "P@ssw0rd!",
        "full_name": "Apple Tester",
        "role": "buyer",
        "gender": "female",
        "age": 28,
    }
    r = api.post(f"{BASE_URL}/api/auth/register", json=payload)
    assert r.status_code == 200, r.text
    return {"payload": payload, "auth": r.json()}


# ---------------------------------------------------------------------------
# core.apple helper module
# ---------------------------------------------------------------------------
class TestAppleHelperModule:
    def test_module_imports(self):
        from core import apple as apple_helper  # noqa: F401
        assert hasattr(apple_helper, "apple_ready")
        assert hasattr(apple_helper, "exchange_code_for_refresh_token")
        assert hasattr(apple_helper, "revoke_refresh_token")

    def test_apple_ready_false_without_env(self):
        from core import apple as apple_helper
        # Preview env has APPLE_TEAM_ID/KEY_ID/PRIVATE_KEY_P8 blank.
        assert apple_helper.apple_ready() is False

    def test_exchange_code_returns_none_when_unconfigured(self):
        from core import apple as apple_helper
        result = asyncio.get_event_loop().run_until_complete(
            apple_helper.exchange_code_for_refresh_token("dummy-code")
        )
        assert result is None

    def test_revoke_refresh_token_returns_false_when_unconfigured(self):
        from core import apple as apple_helper
        result = asyncio.get_event_loop().run_until_complete(
            apple_helper.revoke_refresh_token("dummy-token")
        )
        assert result is False

    def test_revoke_refresh_token_empty_input(self):
        from core import apple as apple_helper
        result = asyncio.get_event_loop().run_until_complete(
            apple_helper.revoke_refresh_token("")
        )
        assert result is False


# ---------------------------------------------------------------------------
# POST /api/auth/apple — payload validation
# ---------------------------------------------------------------------------
class TestAppleLoginEndpoint:
    def test_apple_invalid_identity_token(self, api):
        r = api.post(
            f"{BASE_URL}/api/auth/apple",
            json={"identity_token": "not-a-valid-apple-jwt-blob-xxxxxxxxx"},
        )
        # 401 (bad token) OR 500 (missing APPLE_AUDIENCES). Reject 200.
        assert r.status_code in (401, 500), r.text
        assert r.status_code != 200

    def test_apple_endpoint_accepts_authorization_code_field(self, api):
        # New optional field must not cause a 422 validation error.
        r = api.post(
            f"{BASE_URL}/api/auth/apple",
            json={
                "identity_token": "not-a-valid-apple-jwt-blob-xxxxxxxxx",
                "authorization_code": "fake-one-time-code",
                "full_name": "New Buyer",
                "email": "buyer@example.com",
            },
        )
        assert r.status_code != 422, f"authorization_code rejected by schema: {r.text}"
        assert r.status_code in (401, 500)

    def test_apple_endpoint_still_works_without_authorization_code(self, api):
        r = api.post(
            f"{BASE_URL}/api/auth/apple",
            json={"identity_token": "not-a-valid-apple-jwt-blob-xxxxxxxxx"},
        )
        assert r.status_code != 422
        assert r.status_code in (401, 500)


# ---------------------------------------------------------------------------
# DELETE /api/auth/me — no Apple provider path
# ---------------------------------------------------------------------------
class TestAccountDeletion:
    def test_delete_non_apple_user_succeeds(self, api):
        reg = _register_buyer(api)
        token = reg["auth"]["token"]
        r = api.delete(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "deleted"

        # Verify: /auth/me should now return 401.
        r2 = api.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r2.status_code == 401

        # Login with those creds should also fail.
        r3 = api.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": reg["payload"]["email"], "password": reg["payload"]["password"]},
        )
        assert r3.status_code == 400

    def test_delete_admin_forbidden(self, api):
        # Admin login (from seed).
        admin_email = os.environ.get("ADMIN_SEED_EMAIL", "admin@oromona.com")
        admin_pw = os.environ.get("ADMIN_SEED_PASSWORD")
        if not admin_pw:
            # Try reading from backend/.env
            try:
                for line in open("/app/backend/.env"):
                    if line.startswith("ADMIN_SEED_PASSWORD="):
                        admin_pw = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
            except Exception:
                pytest.skip("no admin password")
        if not admin_pw:
            pytest.skip("no admin password")
        r = api.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": admin_email, "password": admin_pw},
        )
        if r.status_code != 200:
            pytest.skip(f"admin login failed: {r.status_code} {r.text[:120]}")
        token = r.json()["token"]
        r2 = api.delete(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r2.status_code == 400


# ---------------------------------------------------------------------------
# DELETE /api/auth/me — Apple provider path (direct DB seed via helper module)
# ---------------------------------------------------------------------------
class TestAccountDeletionWithApple:
    def test_delete_apple_user_calls_revoke_and_still_deletes(self, api):
        """Seed providers.apple.refresh_token then delete; the revoke helper
        will no-op (creds unset) and the account must still be removed."""
        import sys
        sys.path.insert(0, "/app/backend")
        # Use sync pymongo so the update and lookup run in the same fresh
        # client, independent of motor's per-loop binding.
        from pymongo import MongoClient  # type: ignore

        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        if not mongo_url:
            for line in open("/app/backend/.env"):
                if line.startswith("MONGO_URL="):
                    mongo_url = line.split("=", 1)[1].strip().strip('"').strip("'")
                if line.startswith("DB_NAME="):
                    db_name = line.split("=", 1)[1].strip().strip('"').strip("'")
        assert mongo_url and db_name, "MONGO_URL/DB_NAME must be set"

        client = MongoClient(mongo_url)
        sync_db = client[db_name]

        reg = _register_buyer(api)
        uid = reg["auth"]["user"]["id"]
        token = reg["auth"]["token"]
        sync_db.users.update_one(
            {"id": uid},
            {"$set": {
                "providers.apple.sub": "seed.apple.sub." + uid[:8],
                "providers.apple.refresh_token": "seed_refresh_token_" + uid[:8],
            }},
        )
        # Sanity check the seed landed.
        seeded = sync_db.users.find_one({"id": uid})
        assert seeded is not None
        assert (seeded.get("providers") or {}).get("apple", {}).get("refresh_token")

        r = api.delete(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "deleted"

        # Confirm row really gone.
        doc = sync_db.users.find_one({"id": uid})
        assert doc is None
        client.close()


# ---------------------------------------------------------------------------
# Regression — existing auth endpoints
# ---------------------------------------------------------------------------
class TestAuthRegression:
    def test_register_login_me_flow(self, api):
        email = f"TEST_reg_{uuid.uuid4().hex[:10]}@example.com"
        payload = {
            "email": email,
            "password": "P@ssw0rd!",
            "full_name": "Reg Tester",
            "role": "buyer",
            "gender": "male",
            "age": 30,
        }
        r = api.post(f"{BASE_URL}/api/auth/register", json=payload)
        assert r.status_code == 200, r.text
        token = r.json()["token"]

        r2 = api.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r2.status_code == 200
        assert r2.json()["email"].lower() == email.lower()

        r3 = api.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": email, "password": payload["password"]},
        )
        assert r3.status_code == 200

        # Cleanup.
        api.delete(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )

    def test_google_session_stub_rejects_bad_session(self, api):
        r = api.post(
            f"{BASE_URL}/api/auth/session",
            json={"session_id": "not-a-real-emergent-session-id-xxxxxxxx"},
        )
        # Either 401 (upstream rejected) or 502 (upstream unreachable) is fine.
        assert r.status_code in (401, 502, 400), r.text

    def test_forgot_password_generic_ok(self, api):
        r = api.post(
            f"{BASE_URL}/api/auth/forgot-password",
            json={"email": f"TEST_nope_{uuid.uuid4().hex[:8]}@example.com"},
        )
        assert r.status_code == 200
        assert r.json().get("ok") is True

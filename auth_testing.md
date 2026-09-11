# Apple Sign In — Testing Guide (updated with token revocation)

## Overview

Apple Sign In is fully integrated (POST /api/auth/apple) with server-side
identity_token verification against Apple's JWKS. This document covers
the *token revocation* flow added for Apple App Review Guideline 5.1.1(v).

## Server config (backend/.env)

Required for the revocation flow — Apple Sign In LOGIN keeps working
without them, but account deletion cannot revoke tokens until they're set.

| Env var                | Where to get it                                         |
| ---------------------- | ------------------------------------------------------- |
| `APPLE_AUDIENCES`      | Comma-list: bundle id + `host.exp.Exponent` for Expo Go |
| `APPLE_TEAM_ID`        | 10-char Team ID (top-right of the Membership page)      |
| `APPLE_KEY_ID`         | 10-char Key ID of the "Sign in with Apple" .p8 key      |
| `APPLE_CLIENT_ID`      | Bundle identifier (currently `com.oromona.myapp`)       |
| `APPLE_PRIVATE_KEY_P8` | PEM contents of the .p8 file, newlines as `\n`          |

**Missing config policy**: `core/apple.py` logs a warning and returns
`None` / `False` — login still works, delete_account still succeeds, but
the /auth/revoke call is skipped.

## Manual test — refresh_token persist

1. Sign in with Apple on a physical iOS device (first-time sign in).
2. Confirm `POST /api/auth/apple` receives `authorization_code` (network log).
3. Backend log must show:
   `apple: refresh_token persisted for user <uid>`
4. Mongo shell:
   ```
   db.users.findOne({_id: <uid>}, {"providers.apple": 1})
   ```
   Should contain `refresh_token` and `refresh_token_saved_at`.

## Manual test — account deletion revokes token

1. Sign in as an Apple user with a persisted refresh_token.
2. Profile → Delete Account → confirm.
3. Backend log must show:
   `account-delete: apple revoke user=<uid> ok=True`
4. Confirm HTTP 200 on `DELETE /api/auth/me`.
5. Attempt to sign in again with the same Apple ID — a fresh /api/auth/apple
   call should succeed (creates a new user row); the old row is gone.

## Backend unit test (dry run)

Without real Apple creds, verify the graceful path:

```
# tests/test_apple_revoke.py
from core import apple

def test_revoke_skipped_when_unconfigured(monkeypatch):
    for k in ("APPLE_TEAM_ID","APPLE_KEY_ID","APPLE_CLIENT_ID","APPLE_PRIVATE_KEY_P8"):
        monkeypatch.delenv(k, raising=False)
    import asyncio
    assert asyncio.run(apple.revoke_refresh_token("dummy")) is False
```

## Rollout checklist

- [ ] Add `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY_P8` to prod .env.
- [ ] Confirm `APPLE_CLIENT_ID=com.oromona.myapp`.
- [ ] Ship a build to TestFlight, sign in, delete account.
- [ ] Verify Apple ID → Settings → Password & Security → Apps Using Apple ID:
      Oromona no longer appears after deletion.

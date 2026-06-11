"""Iteration 13 smoke test — confirm toggle-role still works for seller→buyer."""
import os
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL")).rstrip("/")

SELLER = {"email": "atelier@aurafit.demo", "password": "demo-seller-2026"}


def _login(payload):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


def test_seller_toggle_to_buyer_and_back():
    """Seller flips to buyer (no extra data needed) and then back to seller."""
    # 1. Login as seller
    login_body = _login({**SELLER, "as_role": "seller"})
    token = login_body["token"]
    assert login_body["user"]["role"] == "seller"

    # 2. Toggle to buyer
    r = requests.post(
        f"{BASE_URL}/api/user/toggle-role",
        headers={"Authorization": f"Bearer {token}"},
        json={"to": "buyer"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["role"] == "buyer"
    assert "token" in body and body["token"] != token

    # 3. Toggle back to seller using NEW token (company_name + location already on doc)
    new_token = body["token"]
    r2 = requests.post(
        f"{BASE_URL}/api/user/toggle-role",
        headers={"Authorization": f"Bearer {new_token}"},
        json={"to": "seller"},
        timeout=20,
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["user"]["role"] == "seller"

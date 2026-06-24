"""Phase D smoke test: per-size dimensions populated on fit-score endpoint."""
import os
import requests
import pytest

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if "EXPO_PUBLIC_BACKEND_URL" in os.environ else "https://fit-finder-app-5.preview.emergentagent.com"


@pytest.fixture(scope="module")
def buyer_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "buyer@aurafit.demo", "password": "demo-buyer-2026"},
        timeout=20,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth_headers(buyer_token):
    return {"Authorization": f"Bearer {buyer_token}"}


def _list_items(auth_headers):
    r = requests.get(f"{BASE_URL}/api/items", headers=auth_headers, timeout=20)
    assert r.status_code == 200, r.text
    payload = r.json()
    # Some APIs wrap in {items: [...]}, others return list
    if isinstance(payload, dict):
        return payload.get("items", payload.get("data", []))
    return payload


def test_shirt_fit_score_has_per_size_diffs(auth_headers):
    items = _list_items(auth_headers)
    # Find shirts with per-size dimensions
    target_names = ["Oversized Knit Pullover", "Tailored Linen Shirt"]
    targets = [it for it in items if it.get("name") in target_names]
    assert targets, f"Could not find target shirts in catalog. Got {len(items)} items."

    needed_dims = {"chest_cm", "shoulder_cm", "sleeve_cm", "length_cm"}
    for item in targets:
        item_id = item["id"]
        r = requests.get(
            f"{BASE_URL}/api/items/{item_id}/fit-score",
            headers=auth_headers,
            timeout=20,
        )
        assert r.status_code == 200, f"{item['name']}: {r.status_code} {r.text}"
        body = r.json()
        assert "per_size" in body, f"{item['name']}: missing per_size"
        assert isinstance(body["per_size"], list) and len(body["per_size"]) > 0
        # For each size in per_size, check dimensions[].key & .diff populated for needed dims
        for size in body["per_size"]:
            dims = size.get("dimensions", [])
            keys_with_diff = {d["key"] for d in dims if d.get("diff") is not None}
            missing = needed_dims - keys_with_diff
            assert not missing, (
                f"{item['name']} size {size.get('label')}: missing diff for {missing}. "
                f"dimensions={dims}"
            )
        print(f"OK: {item['name']} ({item_id}) -- per_size diffs populated for {needed_dims}")


def test_shoes_fit_score_has_no_per_size_garment_dims(auth_headers):
    """For a shoe item we expect either no per_size or per_size without
    chest/shoulder/sleeve/length diffs (since it's footwear)."""
    items = _list_items(auth_headers)
    shoe = next((it for it in items if it.get("name") == "Pointed Leather Mule"), None)
    if not shoe:
        pytest.skip("Pointed Leather Mule not seeded")
    r = requests.get(
        f"{BASE_URL}/api/items/{shoe['id']}/fit-score",
        headers={"Authorization": auth_headers["Authorization"]},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # Either no per_size or per_size lacks garment dims
    per_size = body.get("per_size") or []
    garment_dims = {"chest_cm", "shoulder_cm", "sleeve_cm"}
    for size in per_size:
        dims = size.get("dimensions", [])
        keys = {d["key"] for d in dims if d.get("diff") is not None}
        assert not (keys & garment_dims), (
            f"Shoe size {size.get('label')} unexpectedly has garment dims: {keys & garment_dims}"
        )
    print(f"OK: shoe item {shoe['id']} - no garment dims in per_size (as expected)")

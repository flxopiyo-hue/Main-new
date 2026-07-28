"""Quick e2e smoke of the Phase-1 courier system (synthetic data, cleaned up)."""
import base64
import uuid

import httpx

BASE = "http://localhost:8001/api"
c = httpx.Client(timeout=60)


def login(email, pw):
    r = c.post(f"{BASE}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


# 1. Courier registration → pending
rider_email = f"test_rider_{uuid.uuid4().hex[:6]}@test.com"
r = c.post(f"{BASE}/auth/register", json={
    "email": rider_email, "password": "rider-pass-123", "full_name": "Test Rider",
    "role": "courier", "phone": "0712345678", "mpesa_number": "0712345678"})
assert r.status_code == 200, r.text
rider_tok = r.json()["token"]
me = c.get(f"{BASE}/courier/me", headers=H(rider_tok)).json()
print("1. rider registered, status:", me["courier_status"])
jr = c.get(f"{BASE}/courier/jobs", headers=H(rider_tok))
print("2. jobs while pending →", jr.status_code, "(expect 403)")

# 2. Admin approves
admin_tok = login("admin@oromona.com", "oromona-admin-2026")
riders = c.get(f"{BASE}/admin/couriers", headers=H(admin_tok)).json()
rid = next(x["id"] for x in riders if x["email"] == rider_email)
ar = c.post(f"{BASE}/admin/couriers/{rid}/approve", headers=H(admin_tok))
print("3. admin approve →", ar.status_code)
rider_tok = login(rider_email, "rider-pass-123")  # token_version bumped → re-login
print("4. rider re-login + jobs →", c.get(f"{BASE}/courier/jobs", headers=H(rider_tok)).status_code)

# 3. Buyer: address in Karen + quotes
buyer_tok = login("buyer@aurafit.com", "demo-buyer-2026")
addr = c.post(f"{BASE}/addresses", json={
    "label": "other", "recipient_name": "Test Buyer", "phone": "0700000001",
    "building_estate": "Karen Estate", "house_number": "12", "street": "Karen Rd",
    "area": "Karen", "city": "Nairobi", "country": "Kenya"}, headers=H(buyer_tok))
assert addr.status_code == 200, addr.text
addr_id = addr.json()["id"]
q1 = c.post(f"{BASE}/delivery/quote", json={"address_id": addr_id, "item_total_cents": 150000, "currency": "KES"}, headers=H(buyer_tok)).json()
print("5. Karen quote:", q1["zone_label"], q1["fee_due_cents"], "(expect nairobi outer 60000)")
q2 = c.post(f"{BASE}/delivery/quote", json={"address_id": addr_id, "item_total_cents": 2500000, "currency": "KES"}, headers=H(buyer_tok)).json()
print("6. free-delivery quote over KSh 20k: free_applied =", q2["free_applied"], "fee_due =", q2["fee_due_cents"])

# 4. Synthetic paid order (door, Karen) for the demo seller
seller_tok = login("atelier@aurafit.com", "demo-seller-2026")
# toggle-role FLIPS the role each call — only flip when not already seller.
for _ in range(2):
    me_r = c.get(f"{BASE}/auth/me", headers=H(seller_tok)).json()
    role_now = me_r.get("role") or me_r.get("user", {}).get("role")
    if role_now == "seller":
        break
    c.post(f"{BASE}/user/toggle-role", json={"role": "seller"}, headers=H(seller_tok))
    seller_tok = login("atelier@aurafit.com", "demo-seller-2026")
from pymongo import MongoClient
import re
env = open("/app/backend/.env").read()
uri = re.search(r'MONGO_URL="?([^"\n]+)"?', env).group(1)
dbname = re.search(r'DB_NAME="?([^"\n]+)"?', env)
db = MongoClient(uri)[dbname.group(1) if dbname else "test_database"]
buyer = db.users.find_one({"email": "buyer@aurafit.com"})
seller = db.users.find_one({"email": "atelier@aurafit.com"})
item = db.items.find_one({"seller_id": seller["id"]}) or db.items.find_one({})
from datetime import datetime, timezone
order_id = str(uuid.uuid4())
db.orders.insert_one({
    "id": order_id, "buyer_id": buyer["id"], "seller_id": item["seller_id"],
    "item_id": item["id"], "item_name": "TEST_Courier Tee", "size": "M",
    "amount_cents": 150000, "currency": "KES", "status": "paid",
    "session_id": f"test_{order_id[:8]}", "paystack_reference": f"test_{order_id[:8]}",
    "platform_fee_cents": 22500, "seller_net_cents": 127500,
    "delivery_option": "door", "delivery_fee_cents": 60000,
    "delivery_zone_key": "nairobi_outer", "delivery_zone_label": "Outer Nairobi",
    "shipping_address": {"recipient_name": "Test Buyer", "phone": "0700000001",
                          "building_estate": "Karen Estate", "house_number": "12",
                          "street": "Karen Rd", "area": "Karen", "city": "Nairobi"},
    "created_at": datetime.now(timezone.utc),
})
print("7. synthetic paid order created")

# 5. Seller requests courier
fr = c.post(f"{BASE}/seller/orders/{order_id}/fulfillment", json={"action": "request_courier"},
            headers=H(login("atelier@aurafit.com", "demo-seller-2026") if False else seller_tok))
print("8. request_courier →", fr.status_code, fr.text[:120] if fr.status_code != 200 else "")

# 6. Rider: board → accept → picked_up → out_for_delivery → deliver w/ code
board = c.get(f"{BASE}/courier/jobs", headers=H(rider_tok)).json()
job = next(j for j in board["open"] if j["order_id"] == order_id)
print("9. job on board: rider cut =", job["rider_cut_cents"], "(expect 54000 = 90% of 60000)")
acc = c.post(f"{BASE}/courier/jobs/{job['id']}/accept", headers=H(rider_tok))
print("10. accept →", acc.status_code, "| dropoff phone visible:", bool(acc.json().get("dropoff_address", {}).get("phone")))
s1 = c.post(f"{BASE}/courier/jobs/{job['id']}/status", json={"action": "picked_up"}, headers=H(rider_tok))
s2 = c.post(f"{BASE}/courier/jobs/{job['id']}/status", json={"action": "out_for_delivery"}, headers=H(rider_tok))
print("11. picked_up/out_for_delivery →", s1.status_code, s2.status_code)

od = c.get(f"{BASE}/orders/{order_id}", headers=H(buyer_tok)).json()
print("12. buyer sees: status", od["status"], "| courier", od["courier"]["status"], "| rider", od["courier"]["rider_name"], "| code", od["handover_code"])
od_seller = c.get(f"{BASE}/orders/{order_id}", headers=H(seller_tok)).json()
print("13. seller sees handover_code:", od_seller.get("handover_code"), "(expect None)")

bad = c.post(f"{BASE}/courier/jobs/{job['id']}/deliver", json={"code": "0000" if od["handover_code"] != "0000" else "1111"}, headers=H(rider_tok))
print("14. wrong code →", bad.status_code, "(expect 400)")
good = c.post(f"{BASE}/courier/jobs/{job['id']}/deliver", json={"code": od["handover_code"]}, headers=H(rider_tok))
print("15. correct code →", good.status_code, good.json())

earn = c.get(f"{BASE}/courier/earnings", headers=H(rider_tok)).json()
print("16. earnings: today", earn["today_cents"], "pending", earn["pending_cents"])
od2 = c.get(f"{BASE}/orders/{order_id}", headers=H(buyer_tok)).json()
print("17. order after delivery: status", od2["status"], "escrow", od2.get("escrow_status"))

# 7. Admin mark-paid + zone patch round-trip
mp = c.post(f"{BASE}/admin/couriers/{rid}/mark-paid", headers=H(admin_tok))
print("18. mark-paid →", mp.status_code, mp.json())
zp = c.patch(f"{BASE}/admin/delivery-zones/nairobi_outer", json={"fee_cents": 65000}, headers=H(admin_tok))
zr = c.patch(f"{BASE}/admin/delivery-zones/nairobi_outer", json={"fee_cents": 60000}, headers=H(admin_tok))
print("19. zone patch/restore →", zp.status_code, zr.status_code)

# Cleanup synthetic artifacts
db.orders.delete_one({"id": order_id})
db.delivery_jobs.delete_many({"order_id": order_id})
db.courier_earnings.delete_many({"order_id": order_id})
c.delete(f"{BASE}/addresses/{addr_id}", headers=H(buyer_tok))
print("20. cleanup done (rider account kept for UI testing:", rider_email + ")")

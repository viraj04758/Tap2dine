"""Quick smoke-test for all new Tap2Dine v3 endpoints."""
import urllib.request, urllib.error, json, sys

BASE = "http://localhost:8000/api"
PASS = []; FAIL = []

def req(method, path, body=None):
    url  = BASE + path
    data = json.dumps(body).encode() if body else None
    r    = urllib.request.Request(url, data=data, method=method,
            headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(r, timeout=5) as resp:
        return json.loads(resp.read()), resp.status

def check(name, method, path, body=None, expect_key=None, expect_status=200):
    try:
        data, status = req(method, path, body)
        assert status in (expect_status, 200, 201), f"Status {status}"
        if expect_key:
            assert expect_key in data, f"Missing key '{expect_key}'"
        PASS.append(name)
        val = data.get(expect_key, "ok") if expect_key else "ok"
        if isinstance(val, list): val = f"{len(val)} items"
        print(f"  [PASS] {name} -> {val}")
        return data
    except Exception as e:
        FAIL.append(name)
        print(f"  [FAIL] {name}: {e}")
        return {}

print("\n--- HEALTH ---")
check("GET /health", "GET", "/health", expect_key="status")

print("\n--- MENU ---")
m = check("GET /menu", "GET", "/menu?restaurant_id=tap2dine", expect_key="items")

print("\n--- RECOMMENDATIONS ---")
cart = []
if m.get("items"):
    i = m["items"][0]
    cart = [{"id":i["id"],"name":i["name"],"emoji":i["emoji"],"price":i["price"],"qty":1,"cat":i.get("cat","starters")}]
check("POST /recommendations", "POST", "/recommendations",
      body={"cart": cart, "restaurant_id": "tap2dine"},
      expect_key="recommendations", expect_status=200)

print("\n--- ORDERS ---")
order_body = {
    "table": "5",
    "items": [{"id":1,"name":"Paneer Tikka","emoji":"🧆","price":249,"qty":1}],
    "subtotal": 249, "tax": 12, "total": 261,
    "payment_method": "cash"
}
o = check("POST /orders", "POST", "/orders", body=order_body,
          expect_key="order", expect_status=201)
order_id = o.get("order", {}).get("id")

check("GET /orders", "GET", "/orders?restaurant_id=tap2dine", expect_key="orders")
check("GET /orders/stats", "GET", "/orders/stats?restaurant_id=tap2dine", expect_key="total_orders")

if order_id:
    check("PATCH /orders status", "PATCH", f"/orders/{order_id}",
          body={"status":"Preparing"}, expect_key="order")

print("\n--- RESERVATIONS ---")
res_body = {
    "restaurant_id": "tap2dine",
    "name": "Test User",
    "phone": "+91 99000 00001",
    "date": "2026-05-01",
    "time": "19:30",
    "guests": 3,
    "table_pref": "Window",
    "special_requests": "Nut allergy"
}
rv = check("POST /reservations", "POST", "/reservations", body=res_body,
           expect_key="reservation", expect_status=201)
res_id = rv.get("reservation", {}).get("id")

check("GET /reservations", "GET", "/reservations?restaurant_id=tap2dine", expect_key="reservations")

if res_id:
    check("PATCH /reservations confirm", "PATCH", f"/reservations/{res_id}",
          body={"status":"Confirmed"}, expect_key="reservation")

print("\n--- BILL SPLIT ---")
if order_id:
    split_body = {
        "order_id": order_id,
        "split_type": "equal",
        "guests": [
            {"name": "Alice", "amount": 87, "paid": False},
            {"name": "Bob",   "amount": 87, "paid": False},
            {"name": "Carol", "amount": 87, "paid": False},
        ]
    }
    check("POST /split", "POST", f"/orders/{order_id}/split",
          body=split_body, expect_key="split", expect_status=201)
    check("GET /split",  "GET",  f"/orders/{order_id}/split", expect_key="guests")
    check("PATCH /split guest paid", "PATCH", f"/orders/{order_id}/split/0",
          expect_key="split")

print("\n--- POPULAR ---")
check("GET /popular", "GET", "/popular?restaurant_id=tap2dine", expect_key="items")

# Summary
total = len(PASS) + len(FAIL)
print(f"\n{'='*40}")
print(f"Results: {len(PASS)}/{total} passed")
if FAIL:
    print(f"Failed:  {', '.join(FAIL)}")
    sys.exit(1)
else:
    print("All tests passed!")

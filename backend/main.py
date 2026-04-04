from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from models import MenuItem, OrderCreate, OrderStatusUpdate, WaiterCall, CreatePaymentOrder, VerifyPayment
from database import db
import uvicorn
import json
import hmac
import hashlib
import os

# ── RAZORPAY CLIENT (keys from environment) ───────────────────────────────────
try:
    import razorpay
    RAZORPAY_KEY_ID     = os.getenv("RAZORPAY_KEY_ID",     "YOUR_KEY_ID")
    RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "YOUR_KEY_SECRET")
    rzp_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
except ImportError:
    rzp_client = None
    RAZORPAY_KEY_ID     = ""
    RAZORPAY_KEY_SECRET = ""

app = FastAPI(title="Tap2Dine API", version="2.0.0")

# Allow frontend (any origin) to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve the frontend from the parent directory
app.mount("/static", StaticFiles(directory=".."), name="static")


# ── WEBSOCKET MANAGER ─────────────────────────────────────────────────────────
class ConnectionManager:
    """Manages active WebSocket connections and broadcasts events."""

    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, event: str, data: dict):
        """Send a JSON event to every connected client."""
        message = json.dumps({"event": event, "data": data})
        dead = []
        for ws in self.active:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive; client may send pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# ── HEALTH CHECK ──────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok", "message": "Tap2Dine API is running 🍽️"}


# ── MENU ROUTES ───────────────────────────────────────────────────────────────
@app.get("/api/menu")
def get_menu():
    """Return all menu items."""
    return {"items": db.get_menu()}


@app.post("/api/menu", status_code=201)
async def add_menu_item(item: MenuItem):
    """Admin: Add a new menu item."""
    new_item = db.add_menu_item(item.dict())
    await manager.broadcast("menu_updated", {"action": "added", "item": new_item})
    return {"message": "Item added", "item": new_item}


@app.delete("/api/menu/{item_id}")
async def delete_menu_item(item_id: int):
    """Admin: Remove a menu item by ID."""
    success = db.delete_menu_item(item_id)
    if not success:
        raise HTTPException(status_code=404, detail="Menu item not found")
    await manager.broadcast("menu_updated", {"action": "deleted", "item_id": item_id})
    return {"message": f"Item {item_id} deleted"}


# ── ORDER ROUTES ──────────────────────────────────────────────────────────────
@app.post("/api/orders", status_code=201)
async def place_order(order: OrderCreate):
    """Customer: Place a new order."""
    new_order = db.place_order(order.dict())
    # Notify admin panel in real-time
    await manager.broadcast("new_order", new_order)
    return {"message": "Order placed!", "order": new_order}


@app.get("/api/orders")
def get_orders(table: str = None, status: str = None):
    """Admin: Get all orders, optionally filtered by table or status."""
    orders = db.get_orders()
    if table:
        orders = [o for o in orders if str(o["table"]) == str(table)]
    if status:
        orders = [o for o in orders if o["status"].lower() == status.lower()]
    return {"orders": orders, "count": len(orders)}


@app.patch("/api/orders/{order_id}")
async def update_order_status(order_id: str, update: OrderStatusUpdate):
    """Admin: Update order status (Preparing / Ready / Delivered)."""
    valid = ["Pending", "Preparing", "Ready", "Delivered"]
    if update.status not in valid:
        raise HTTPException(status_code=400, detail=f"Status must be one of {valid}")
    updated = db.update_order_status(order_id, update.status)
    if not updated:
        raise HTTPException(status_code=404, detail="Order not found")
    # Notify all connected clients (admin + customer status tracking)
    await manager.broadcast("order_status_changed", updated)
    return {"message": f"Order {order_id} marked as {update.status}", "order": updated}


@app.delete("/api/orders")
async def clear_orders():
    """Admin: Delete all orders."""
    db.clear_orders()
    await manager.broadcast("orders_cleared", {})
    return {"message": "All orders cleared"}


@app.get("/api/orders/stats")
def order_stats():
    """Admin: Get order count and revenue stats."""
    return db.get_stats()


# ── POPULAR ITEMS ─────────────────────────────────────────────────────────────
# Curated fallback when no orders exist yet (good for fresh demo)
_CURATED_POPULAR_IDS = [5, 8, 2, 10, 16, 20]   # Butter Chicken, Chicken Biryani, etc.

@app.get("/api/popular")
def popular_items():
    """Customer: Return top 5 items by order frequency; fallback to curated picks."""
    stats  = db.get_stats()
    menu   = {item["id"]: item for item in db.get_menu()}

    if stats["top_items"]:
        # Use live order data
        result = []
        for entry in stats["top_items"][:5]:
            item = next((m for m in db.get_menu() if m["name"] == entry["name"]), None)
            if item:
                result.append({**item, "order_count": entry["count"]})
        if result:
            return {"items": result, "source": "live"}

    # Fallback to curated list
    curated = [menu[i] for i in _CURATED_POPULAR_IDS if i in menu]
    return {"items": curated[:5], "source": "curated"}


# ── WAITER CALL ───────────────────────────────────────────────────────────────
@app.post("/api/waiter-call", status_code=201)
async def waiter_call(call: WaiterCall):
    """Customer: Ring the waiter for a table."""
    call_data = {"table": call.table, "reason": call.reason or "Assistance needed"}
    await manager.broadcast("waiter_call", call_data)
    return {"message": f"Waiter notified for Table {call.table}"}


# ── RAZORPAY PAYMENT ─────────────────────────────────────────────────────────
@app.post("/api/payment/create-order", status_code=201)
def create_payment_order(body: CreatePaymentOrder):
    """Create a Razorpay order for the given INR amount."""
    if rzp_client is None:
        raise HTTPException(status_code=503, detail="Razorpay SDK not installed")
    if RAZORPAY_KEY_ID == "YOUR_KEY_ID":
        raise HTTPException(status_code=503, detail="Razorpay keys not configured")
    try:
        order = rzp_client.order.create({
            "amount":   body.amount * 100,   # paise
            "currency": body.currency,
            "receipt":  body.receipt or f"rcpt_{body.amount}",
            "payment_capture": 1,
        })
        return {
            "order_id":  order["id"],
            "amount":    order["amount"],
            "currency":  order["currency"],
            "key_id":    RAZORPAY_KEY_ID,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/payment/verify")
def verify_payment(body: VerifyPayment):
    """Verify Razorpay payment signature (HMAC-SHA256)."""
    if not RAZORPAY_KEY_SECRET or RAZORPAY_KEY_SECRET == "YOUR_KEY_SECRET":
        raise HTTPException(status_code=503, detail="Razorpay secret not configured")

    msg     = f"{body.razorpay_order_id}|{body.razorpay_payment_id}"
    digest  = hmac.new(
        RAZORPAY_KEY_SECRET.encode(),
        msg.encode(),
        hashlib.sha256
    ).hexdigest()

    if hmac.compare_digest(digest, body.razorpay_signature):
        return {"status": "success", "message": "Payment verified ✅"}
    else:
        raise HTTPException(status_code=400, detail="Signature mismatch – payment invalid")


# ── RUN ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

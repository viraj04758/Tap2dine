from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from models import (
    MenuItem, OrderCreate, OrderStatusUpdate, WaiterCall,
    CreatePaymentOrder, VerifyPayment,
    RestaurantCreate, RecommendationRequest,
    ReservationCreate, ReservationStatusUpdate,
    BillSplitCreate, FeedbackCreate,
)
from database import db, init_db
from ai import get_recommendations
import uvicorn
import json
import hmac
import hashlib
import os
from dotenv import load_dotenv

load_dotenv()

# ── RAZORPAY ──────────────────────────────────────────────────────────────────
try:
    import razorpay
    RAZORPAY_KEY_ID     = os.getenv("RAZORPAY_KEY_ID",     "")
    RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
    rzp_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)) if RAZORPAY_KEY_ID else None
except ImportError:
    rzp_client = None
    RAZORPAY_KEY_ID = RAZORPAY_KEY_SECRET = ""

# ── APP ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Tap2Dine API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve the frontend from the parent directory
app.mount("/static", StaticFiles(directory=".."), name="static")


# ── STARTUP: initialise SQLite / PostgreSQL ───────────────────────────────────
@app.on_event("startup")
def startup():
    init_db()
    print("[OK] Database initialised (SQLite/PostgreSQL ready)")


# ── WEBSOCKET MANAGER ─────────────────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, event: str, data: dict):
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
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# ── HEALTH ────────────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok", "message": "Tap2Dine API v3.0 is running"}


# ── RESTAURANTS (Multi-SaaS) ──────────────────────────────────────────────────
@app.get("/api/restaurants")
def list_restaurants():
    return {"restaurants": db.get_restaurants()}


@app.get("/api/restaurants/{restaurant_id}")
def get_restaurant(restaurant_id: str):
    r = db.get_restaurant(restaurant_id)
    if not r:
        raise HTTPException(status_code=404, detail="Restaurant not found")
    return r


@app.post("/api/restaurants", status_code=201)
async def create_restaurant(body: RestaurantCreate):
    existing = db.get_restaurant(body.id)
    if existing:
        raise HTTPException(status_code=409, detail=f"Restaurant '{body.id}' already exists")
    # Seed an empty menu for the new restaurant (no items)
    result = db.create_restaurant(body.dict())
    await manager.broadcast("restaurant_created", result)
    return {"message": "Restaurant created", "restaurant": result}


# ── MENU ──────────────────────────────────────────────────────────────────────
@app.get("/api/menu")
def get_menu(restaurant_id: str = Query("tap2dine")):
    return {"items": db.get_menu(restaurant_id)}


@app.post("/api/menu", status_code=201)
async def add_menu_item(item: MenuItem):
    data = item.dict()
    new_item = db.add_menu_item(data)
    await manager.broadcast("menu_updated", {"action": "added", "item": new_item})
    return {"message": "Item added", "item": new_item}


@app.delete("/api/menu/{item_id}")
async def delete_menu_item(item_id: int):
    success = db.delete_menu_item(item_id)
    if not success:
        raise HTTPException(status_code=404, detail="Menu item not found")
    await manager.broadcast("menu_updated", {"action": "deleted", "item_id": item_id})
    return {"message": f"Item {item_id} deleted"}


# ── AI RECOMMENDATIONS ────────────────────────────────────────────────────────
@app.post("/api/recommendations")
async def recommendations(body: RecommendationRequest):
    """
    Return up to 3 AI-powered (Gemini Flash) complementary item recommendations.
    Falls back to rule-based logic if GEMINI_API_KEY is not set.
    """
    menu = db.get_menu(body.restaurant_id)
    cart = [item.dict() for item in body.cart]
    suggestions = await get_recommendations(cart, menu)
    return {"recommendations": suggestions, "count": len(suggestions)}


# ── ORDERS ────────────────────────────────────────────────────────────────────
@app.post("/api/orders", status_code=201)
async def place_order(order: OrderCreate):
    new_order = db.place_order(order.dict())
    await manager.broadcast("new_order", new_order)
    return {"message": "Order placed!", "order": new_order}


@app.get("/api/orders")
def get_orders(
    table: str = None,
    status: str = None,
    restaurant_id: str = Query("tap2dine"),
):
    orders = db.get_orders(restaurant_id)
    if table:
        orders = [o for o in orders if str(o["table"]) == str(table)]
    if status:
        orders = [o for o in orders if o["status"].lower() == status.lower()]
    return {"orders": orders, "count": len(orders)}


@app.patch("/api/orders/{order_id}")
async def update_order_status(order_id: str, update: OrderStatusUpdate):
    valid = ["Pending", "Preparing", "Ready", "Delivered"]
    if update.status not in valid:
        raise HTTPException(status_code=400, detail=f"Status must be one of {valid}")
    updated = db.update_order_status(order_id, update.status)
    if not updated:
        raise HTTPException(status_code=404, detail="Order not found")
    await manager.broadcast("order_status_changed", updated)
    return {"message": f"Order {order_id} marked as {update.status}", "order": updated}


@app.delete("/api/orders")
async def clear_orders(restaurant_id: str = Query("tap2dine")):
    db.clear_orders(restaurant_id)
    await manager.broadcast("orders_cleared", {})
    return {"message": "All orders cleared"}


@app.get("/api/orders/stats")
def order_stats(restaurant_id: str = Query("tap2dine")):
    return db.get_stats(restaurant_id)


# ── POPULAR ITEMS ─────────────────────────────────────────────────────────────
_CURATED_POPULAR_IDS = [5, 8, 2, 10, 16, 20]

@app.get("/api/popular")
def popular_items(restaurant_id: str = Query("tap2dine")):
    stats = db.get_stats(restaurant_id)
    menu  = {item["id"]: item for item in db.get_menu(restaurant_id)}

    if stats["top_items"]:
        result = []
        for entry in stats["top_items"][:5]:
            item = next((m for m in db.get_menu(restaurant_id) if m["name"] == entry["name"]), None)
            if item:
                result.append({**item, "order_count": entry["count"]})
        if result:
            return {"items": result, "source": "live"}

    curated = [menu[i] for i in _CURATED_POPULAR_IDS if i in menu]
    return {"items": curated[:5], "source": "curated"}


# ── WAITER CALL ───────────────────────────────────────────────────────────────
@app.post("/api/waiter-call", status_code=201)
async def waiter_call(call: WaiterCall):
    call_data = {
        "table": call.table,
        "reason": call.reason or "Assistance needed",
        "restaurant_id": call.restaurant_id,
    }
    await manager.broadcast("waiter_call", call_data)
    return {"message": f"Waiter notified for Table {call.table}"}


# ── RESERVATIONS ──────────────────────────────────────────────────────────────
@app.post("/api/reservations", status_code=201)
async def create_reservation(body: ReservationCreate):
    reservation = db.create_reservation(body.dict())
    await manager.broadcast("new_reservation", reservation)
    return {"message": "Reservation created!", "reservation": reservation}


@app.get("/api/reservations")
def get_reservations(
    restaurant_id: str = Query("tap2dine"),
    date: str = None,
    status: str = None,
):
    reservations = db.get_reservations(restaurant_id, date, status)
    return {"reservations": reservations, "count": len(reservations)}


@app.patch("/api/reservations/{reservation_id}")
async def update_reservation(reservation_id: int, update: ReservationStatusUpdate):
    valid = ["Pending", "Confirmed", "Cancelled", "Completed", "No-show"]
    if update.status not in valid:
        raise HTTPException(status_code=400, detail=f"Status must be one of {valid}")
    updated = db.update_reservation_status(reservation_id, update.status)
    if not updated:
        raise HTTPException(status_code=404, detail="Reservation not found")
    await manager.broadcast("reservation_updated", updated)
    return {"message": f"Reservation {reservation_id} updated to {update.status}", "reservation": updated}


# ── BILL SPLITTING ────────────────────────────────────────────────────────────
@app.post("/api/orders/{order_id}/split", status_code=201)
async def create_bill_split(order_id: str, body: BillSplitCreate):
    """Create or replace a bill split for an order."""
    guests = [g.dict() for g in body.guests]
    # Ensure all have a 'paid' field
    for g in guests:
        g.setdefault("paid", False)
    split = db.create_split(order_id, body.split_type, guests)
    await manager.broadcast("bill_split_created", {"order_id": order_id, "split": split})
    return {"message": "Bill split created", "split": split}


@app.get("/api/orders/{order_id}/split")
def get_bill_split(order_id: str):
    split = db.get_split(order_id)
    if not split:
        raise HTTPException(status_code=404, detail="No bill split found for this order")
    return split


@app.patch("/api/orders/{order_id}/split/{guest_idx}")
async def mark_guest_paid(order_id: str, guest_idx: int):
    """Mark a specific guest's share as paid."""
    updated = db.mark_split_paid(order_id, guest_idx)
    if not updated:
        raise HTTPException(status_code=404, detail="Bill split or guest not found")
    await manager.broadcast("split_payment_received", {"order_id": order_id, "guest_idx": guest_idx})
    return {"message": f"Guest {guest_idx} marked as paid", "split": updated}


# ── FEEDBACK ─────────────────────────────────────────────────────────────
@app.post("/api/feedback", status_code=201)
async def submit_feedback(body: FeedbackCreate):
    """Submit customer feedback (rating 1-5 + optional comment)."""
    feedback = db.add_feedback(body.dict())
    await manager.broadcast("new_feedback", feedback)
    return {"message": "Thank you for your feedback!", "feedback": feedback}


@app.get("/api/feedback")
def get_feedback(restaurant_id: str = Query("tap2dine")):
    """List all feedback for a restaurant."""
    items = db.get_feedback(restaurant_id)
    return {"feedback": items, "count": len(items)}


# ── ANALYTICS ───────────────────────────────────────────────────────────
@app.get("/api/analytics/revenue")
def analytics_revenue(restaurant_id: str = Query("tap2dine")):
    """Revenue stats: today, this week, this month, all-time, and 7-day chart data."""
    return db.get_revenue_stats(restaurant_id)


@app.get("/api/analytics/peak-hours")
def analytics_peak_hours(restaurant_id: str = Query("tap2dine")):
    """Order count per hour-of-day (0-23) to identify busiest periods."""
    return db.get_peak_hours(restaurant_id)


@app.get("/api/analytics/feedback-summary")
def analytics_feedback_summary(restaurant_id: str = Query("tap2dine")):
    """Feedback summary: average rating, count, and 5 most recent reviews."""
    return db.get_feedback_summary(restaurant_id)


# ── RAZORPAY PAYMENT ──────────────────────────────────────────────────────────
@app.post("/api/payment/create-order", status_code=201)
def create_payment_order(body: CreatePaymentOrder):
    if rzp_client is None:
        raise HTTPException(status_code=503, detail="Razorpay SDK not installed")
    if not RAZORPAY_KEY_ID:
        raise HTTPException(status_code=503, detail="Razorpay keys not configured")
    try:
        order = rzp_client.order.create({
            "amount":   body.amount * 100,
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
    if not RAZORPAY_KEY_SECRET:
        raise HTTPException(status_code=503, detail="Razorpay secret not configured")
    msg    = f"{body.razorpay_order_id}|{body.razorpay_payment_id}"
    digest = hmac.new(
        RAZORPAY_KEY_SECRET.encode(),
        msg.encode(),
        hashlib.sha256
    ).hexdigest()
    if hmac.compare_digest(digest, body.razorpay_signature):
        return {"status": "success", "message": "Payment verified"}
    raise HTTPException(status_code=400, detail="Signature mismatch - payment invalid")


# ── RUN ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

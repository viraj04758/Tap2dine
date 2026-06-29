from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Query, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.base import BaseHTTPMiddleware
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
import logging
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()

# ── LOGGING (item 14) ────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("tap2dine")

# ── RATE LIMITING (item 3) ────────────────────────────────────────────────────
try:
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.util import get_remote_address
    from slowapi.middleware import SlowAPIMiddleware
    from slowapi.errors import RateLimitExceeded
    limiter = Limiter(key_func=get_remote_address)
    _RATE_LIMITING = True
except ImportError:
    limiter = None
    _RATE_LIMITING = False
    logger.warning("slowapi not installed — rate limiting disabled")

# ── JWT AUTH (items #1-3) ────────────────────────────────────────────────────
try:
    from jose import jwt, JWTError
    import bcrypt as _bcrypt
    _JWT_AVAILABLE = True
except ImportError:
    _JWT_AVAILABLE = False
    logger.warning("python-jose or bcrypt not installed — JWT auth disabled")

JWT_SECRET    = os.getenv("JWT_SECRET", "change-me-generate-with-secrets-token-hex-64")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_H  = int(os.getenv("JWT_EXPIRE_HOURS", "8"))

_http_bearer = HTTPBearer(auto_error=False)

# item #2: Admin credentials from env (never hardcode)
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PW_HASH  = os.getenv("ADMIN_PASSWORD_HASH", "")  # bcrypt hash

def _create_token(data: dict) -> str:
    payload = {**data, "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRE_H)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def get_current_admin(
    credentials: HTTPAuthorizationCredentials = Depends(_http_bearer)
):
    """FastAPI dependency — raises 401/403 if token is missing or invalid."""
    if not _JWT_AVAILABLE:
        return {"sub": "admin", "role": "admin"}  # JWT disabled gracefully
    if not credentials:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    return payload

# ── XSS SANITIZER (item #8) ──────────────────────────────────────────────────
try:
    import bleach as _bleach
    def sanitize(text: str) -> str:
        return _bleach.clean(text or "", strip=True)
except ImportError:
    def sanitize(text: str) -> str:
        return text or ""

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
app = FastAPI(
    title="Tap2Dine API",
    version="3.0.0",
    # item 11: hide internal error details in docs
    docs_url=None if os.getenv("VERCEL") else "/docs",
    redoc_url=None if os.getenv("VERCEL") else "/redoc",
)

# item 3: attach rate limiter
if _RATE_LIMITING:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)

# item 1: CORS — restrict to known origins
_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8000",
    "https://tap2dine-ten.vercel.app",
]
if os.getenv("FRONTEND_URL"):
    _ALLOWED_ORIGINS.append(os.getenv("FRONTEND_URL"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# item 9: Security headers middleware
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Frame-Options"]         = "DENY"
        response.headers["X-Content-Type-Options"]  = "nosniff"
        response.headers["Referrer-Policy"]         = "strict-origin-when-cross-origin"
        response.headers["X-XSS-Protection"]        = "1; mode=block"
        response.headers["Permissions-Policy"]      = "geolocation=(), microphone=()"
        return response

app.add_middleware(SecurityHeadersMiddleware)

# item 11: Global exception handler — never leak stack traces
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception: %s", exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error"},
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": "Invalid request data"},
    )


# ── STARTUP: initialise SQLite / PostgreSQL ───────────────────────────────────
@app.on_event("startup")
def startup():
    init_db()
    logger.info("[OK] Database initialised (SQLite/PostgreSQL ready)")


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


# ── HEALTH ───────────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok", "message": "Tap2Dine API v3.0 is running"}


# ── ADMIN AUTH (item #1) ───────────────────────────────────────────────────
@app.post("/api/admin/login")
def admin_login(body: dict):
    """Issue a JWT for the admin user. Credentials come from .env."""
    username = body.get("username", "")
    password = body.get("password", "")

    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password required")

    if username != ADMIN_USERNAME:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if _JWT_AVAILABLE and ADMIN_PW_HASH:
        import bcrypt as _bc
        if not _bc.checkpw(password.encode(), ADMIN_PW_HASH.encode()):
            raise HTTPException(status_code=401, detail="Invalid credentials")
    elif password != os.getenv("ADMIN_PASSWORD", ""):
        # Fallback: plain-text password from env (only if no hash configured)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not _JWT_AVAILABLE:
        raise HTTPException(status_code=503, detail="JWT library not available")

    token = _create_token({"sub": username, "role": "admin"})
    logger.info("Admin login successful: %s", username)
    return {"access_token": token, "token_type": "bearer", "expires_in_hours": JWT_EXPIRE_H}


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
async def add_menu_item(item: MenuItem, _admin=Depends(get_current_admin)):
    data = item.dict()
    new_item = db.add_menu_item(data)
    await manager.broadcast("menu_updated", {"action": "added", "item": new_item})
    return {"message": "Item added", "item": new_item}


@app.delete("/api/menu/{item_id}")
async def delete_menu_item(item_id: int, _admin=Depends(get_current_admin)):
    success = db.delete_menu_item(item_id)
    if not success:
        raise HTTPException(status_code=404, detail="Menu item not found")
    await manager.broadcast("menu_updated", {"action": "deleted", "item_id": item_id})
    return {"message": f"Item {item_id} deleted"}


# ── AI RECOMMENDATIONS ────────────────────────────────────────────────────────
@app.post("/api/recommendations")
async def recommendations(request: Request, body: RecommendationRequest):
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
async def place_order(request: Request, order: OrderCreate):
    if _RATE_LIMITING: await limiter._check_request_limit(request, "10/minute")
    new_order = db.place_order(order.dict())
    await manager.broadcast("new_order", new_order)
    logger.info("New order placed: table=%s", order.dict().get("table"))
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
async def update_order_status(order_id: str, update: OrderStatusUpdate, _admin=Depends(get_current_admin)):
    valid = ["Pending", "Preparing", "Ready", "Delivered"]
    if update.status not in valid:
        raise HTTPException(status_code=400, detail=f"Status must be one of {valid}")
    updated = db.update_order_status(order_id, update.status)
    if not updated:
        raise HTTPException(status_code=404, detail="Order not found")
    await manager.broadcast("order_status_changed", updated)
    return {"message": f"Order {order_id} marked as {update.status}", "order": updated}


@app.delete("/api/orders")
async def clear_orders(restaurant_id: str = Query("tap2dine"), _admin=Depends(get_current_admin)):
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
async def waiter_call(request: Request, call: WaiterCall):
    call_data = {
        "table": call.table,
        "reason": call.reason or "Assistance needed",
        "restaurant_id": call.restaurant_id,
    }
    await manager.broadcast("waiter_call", call_data)
    logger.info("Waiter called: table=%s", call.table)
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
async def submit_feedback(request: Request, body: FeedbackCreate):
    """Submit customer feedback (rating 1-5 + optional comment)."""
    data = body.dict()
    # item #8: sanitize comment to prevent XSS
    if data.get("comment"):
        data["comment"] = sanitize(data["comment"])
    feedback = db.add_feedback(data)
    await manager.broadcast("new_feedback", feedback)
    logger.info("Feedback submitted: rating=%s", data.get("rating"))
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

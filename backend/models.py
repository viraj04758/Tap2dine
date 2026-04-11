from pydantic import BaseModel, Field
from typing import List, Optional


# ── MENU ──────────────────────────────────────────────────────────────────────
class OrderItem(BaseModel):
    id: int
    name: str
    emoji: str
    price: int
    qty: int


class MenuItem(BaseModel):
    name: str
    emoji: str = "🍽️"
    price: int
    cat: str
    desc: str = "Freshly prepared just for you."
    veg: bool = True
    spicy: bool = False
    restaurant_id: Optional[str] = "tap2dine"


# ── ORDERS ────────────────────────────────────────────────────────────────────
class OrderCreate(BaseModel):
    table: str
    items: List[OrderItem]
    subtotal: int
    tax: int
    total: int
    note: Optional[str] = ""
    payment_method: Optional[str] = "online"   # "online" | "cash"
    razorpay_order_id: Optional[str] = None
    razorpay_payment_id: Optional[str] = None
    razorpay_signature: Optional[str] = None
    restaurant_id: Optional[str] = "tap2dine"


class OrderStatusUpdate(BaseModel):
    status: str  # Pending | Preparing | Ready | Delivered


# ── WAITER CALL ───────────────────────────────────────────────────────────────
class WaiterCall(BaseModel):
    table: str
    reason: Optional[str] = ""
    restaurant_id: Optional[str] = "tap2dine"


# ── RAZORPAY ──────────────────────────────────────────────────────────────────
class CreatePaymentOrder(BaseModel):
    amount: int          # total in INR (not paise – backend converts)
    currency: str = "INR"
    receipt: Optional[str] = None


class VerifyPayment(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


# ── RESTAURANT (Multi-SaaS) ───────────────────────────────────────────────────
class RestaurantCreate(BaseModel):
    id: str                         # slug, e.g. "spice-garden"
    name: str
    logo_emoji: Optional[str] = "🍽️"
    address: Optional[str] = ""
    phone: Optional[str] = ""
    currency: Optional[str] = "INR"
    tax_percent: Optional[float] = 5.0


# ── AI RECOMMENDATIONS ────────────────────────────────────────────────────────
class RecommendationRequest(BaseModel):
    cart: List[OrderItem]
    restaurant_id: Optional[str] = "tap2dine"


# ── TABLE RESERVATION ─────────────────────────────────────────────────────────
class ReservationCreate(BaseModel):
    restaurant_id: Optional[str] = "tap2dine"
    name: str
    phone: str
    email: Optional[str] = ""
    date: str           # YYYY-MM-DD
    time: str           # HH:MM (24h)
    guests: int = Field(ge=1, le=20)
    table_pref: Optional[str] = ""   # "indoor" | "outdoor" | "any"
    special_requests: Optional[str] = ""


class ReservationStatusUpdate(BaseModel):
    status: str   # "Confirmed" | "Cancelled" | "Completed" | "No-show"


# ── BILL SPLIT ────────────────────────────────────────────────────────────────
class BillSplitGuest(BaseModel):
    name: str
    amount: int     # in INR


class BillSplitCreate(BaseModel):
    order_id: str
    guests: List[BillSplitGuest]
    split_type: Optional[str] = "equal"   # "equal" | "custom"


# ── FEEDBACK ──────────────────────────────────────────────────────────────────
class FeedbackCreate(BaseModel):
    restaurant_id: Optional[str] = "tap2dine"
    table_no: Optional[str] = ""
    rating: int = Field(ge=1, le=5)
    comment: Optional[str] = ""

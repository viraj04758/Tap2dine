from pydantic import BaseModel, Field
from typing import List, Optional


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


class OrderStatusUpdate(BaseModel):
    status: str  # Pending | Preparing | Ready | Delivered


class WaiterCall(BaseModel):
    table: str
    reason: Optional[str] = ""


# ── RAZORPAY ──────────────────────────────────────────────────────────────────
class CreatePaymentOrder(BaseModel):
    amount: int          # total in INR (not paise – backend converts)
    currency: str = "INR"
    receipt: Optional[str] = None


class VerifyPayment(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str

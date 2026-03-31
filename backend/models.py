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


class OrderStatusUpdate(BaseModel):
    status: str  # Pending | Preparing | Ready | Delivered


class WaiterCall(BaseModel):
    table: str
    reason: Optional[str] = ""

"""
Tap2Dine — SQLAlchemy Database Layer
Supports SQLite (default, zero setup) and PostgreSQL (set DATABASE_URL in .env).
"""
import os
import json
from datetime import datetime, timedelta
from dotenv import load_dotenv

from sqlalchemy import (
    create_engine, Column, Integer, String, Boolean,
    Float, Text, DateTime, ForeignKey, func
)
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker, relationship

load_dotenv()

# ── ENGINE ────────────────────────────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./tap2dine.db")
# SQLite needs check_same_thread=False; PostgreSQL doesn't care about this kwarg
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, echo=False)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


# ── ORM MODELS ────────────────────────────────────────────────────────────────
class Base(DeclarativeBase):
    pass


class RestaurantORM(Base):
    __tablename__ = "restaurants"
    id            = Column(String, primary_key=True)   # slug e.g. "tap2dine"
    name          = Column(String, nullable=False, default="My Restaurant")
    logo_emoji    = Column(String, default="🍽️")
    address       = Column(String, default="")
    phone         = Column(String, default="")
    currency      = Column(String, default="INR")
    tax_percent   = Column(Float, default=5.0)
    created_at    = Column(DateTime, default=datetime.utcnow)


class MenuItemORM(Base):
    __tablename__ = "menu_items"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    restaurant_id = Column(String, ForeignKey("restaurants.id"), default="tap2dine")
    cat           = Column(String, nullable=False)
    name          = Column(String, nullable=False)
    emoji         = Column(String, default="🍽️")
    price         = Column(Integer, nullable=False)
    desc          = Column(Text, default="")
    veg           = Column(Boolean, default=True)
    spicy         = Column(Boolean, default=False)


class OrderORM(Base):
    __tablename__ = "orders"
    id            = Column(String, primary_key=True)
    restaurant_id = Column(String, ForeignKey("restaurants.id"), default="tap2dine")
    table_no      = Column(String, nullable=False)
    items_json    = Column(Text, nullable=False)   # JSON serialised list
    subtotal      = Column(Integer, default=0)
    tax           = Column(Integer, default=0)
    total         = Column(Integer, default=0)
    note          = Column(Text, default="")
    status        = Column(String, default="Pending")
    payment_method= Column(String, default="online")
    razorpay_order_id   = Column(String, default="")
    razorpay_payment_id = Column(String, default="")
    created_at    = Column(DateTime, default=datetime.utcnow)


class ReservationORM(Base):
    __tablename__ = "reservations"
    id              = Column(Integer, primary_key=True, autoincrement=True)
    restaurant_id   = Column(String, ForeignKey("restaurants.id"), default="tap2dine")
    name            = Column(String, nullable=False)
    phone           = Column(String, nullable=False)
    email           = Column(String, default="")
    date            = Column(String, nullable=False)   # YYYY-MM-DD
    time            = Column(String, nullable=False)   # HH:MM
    guests          = Column(Integer, default=2)
    table_pref      = Column(String, default="any")
    special_requests= Column(Text, default="")
    status          = Column(String, default="Pending")   # Pending | Confirmed | Cancelled
    created_at      = Column(DateTime, default=datetime.utcnow)


class BillSplitORM(Base):
    __tablename__ = "bill_splits"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    order_id   = Column(String, ForeignKey("orders.id"), nullable=False)
    split_type = Column(String, default="equal")
    guests_json= Column(Text, nullable=False)   # JSON list of {name, amount, paid}
    created_at = Column(DateTime, default=datetime.utcnow)


class FeedbackORM(Base):
    __tablename__ = "feedback"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    restaurant_id = Column(String, ForeignKey("restaurants.id"), default="tap2dine")
    table_no      = Column(String, default="")
    rating        = Column(Integer, nullable=False)   # 1-5
    comment       = Column(Text, default="")
    created_at    = Column(DateTime, default=datetime.utcnow)


# ── SEED DATA ─────────────────────────────────────────────────────────────────
SEED_MENU = [
    {"cat": "starters", "name": "Veg Spring Rolls",    "emoji": "🥢", "price": 149, "desc": "Crispy golden rolls stuffed with fresh veggies & herbs.",         "veg": True,  "spicy": False},
    {"cat": "starters", "name": "Chicken Tikka",        "emoji": "🍗", "price": 249, "desc": "Juicy marinated chicken tikka with mint chutney.",                 "veg": False, "spicy": True},
    {"cat": "starters", "name": "Paneer Chilli",        "emoji": "🧀", "price": 199, "desc": "Indo-Chinese tossed paneer cubes in tangy sauce.",                 "veg": True,  "spicy": True},
    {"cat": "starters", "name": "Bruschetta",           "emoji": "🥖", "price": 169, "desc": "Toasted bread with tomato, basil & garlic topping.",               "veg": True,  "spicy": False},
    {"cat": "mains",    "name": "Butter Chicken",       "emoji": "🍲", "price": 329, "desc": "Creamy tomato-based curry with tender chicken pieces.",            "veg": False, "spicy": False},
    {"cat": "mains",    "name": "Dal Makhani",          "emoji": "🥘", "price": 249, "desc": "Slow-cooked black lentils in rich butter & cream.",                "veg": True,  "spicy": False},
    {"cat": "mains",    "name": "Veg Biryani",          "emoji": "🍚", "price": 279, "desc": "Aromatic basmati rice with seasonal vegetables & spices.",         "veg": True,  "spicy": True},
    {"cat": "mains",    "name": "Chicken Biryani",      "emoji": "🍛", "price": 349, "desc": "Royal biryani with dum-cooked succulent chicken pieces.",          "veg": False, "spicy": True},
    {"cat": "mains",    "name": "Paneer Butter Masala", "emoji": "🧆", "price": 289, "desc": "Soft paneer in velvety onion-tomato gravy.",                       "veg": True,  "spicy": False},
    {"cat": "pizza",    "name": "Margherita",           "emoji": "🍕", "price": 299, "desc": "Classic pizza with fresh mozzarella, tomato & basil.",            "veg": True,  "spicy": False},
    {"cat": "pizza",    "name": "Pepperoni Fiesta",     "emoji": "🍕", "price": 399, "desc": "Loaded with pepperoni, jalapeños & three cheeses.",                "veg": False, "spicy": True},
    {"cat": "pizza",    "name": "Farm Fresh Veggie",    "emoji": "🍕", "price": 349, "desc": "Seasonal veggies on house tomato sauce & oregano.",                "veg": True,  "spicy": False},
    {"cat": "burgers",  "name": "Classic Beef Burger",  "emoji": "🍔", "price": 299, "desc": "Juicy beef patty with lettuce, tomato & special sauce.",           "veg": False, "spicy": False},
    {"cat": "burgers",  "name": "Crispy Veggie Burger", "emoji": "🍔", "price": 219, "desc": "Golden veggie patty with coleslaw & chipotle mayo.",               "veg": True,  "spicy": False},
    {"cat": "burgers",  "name": "Spicy Chicken Burger", "emoji": "🍔", "price": 269, "desc": "Fiery fried chicken with sriracha & pickled onions.",              "veg": False, "spicy": True},
    {"cat": "desserts", "name": "Chocolate Lava Cake",  "emoji": "🎂", "price": 179, "desc": "Warm choco-lava cake served with vanilla ice cream.",              "veg": True,  "spicy": False},
    {"cat": "desserts", "name": "Gulab Jamun",          "emoji": "🍮", "price": 99,  "desc": "Soft khoya dumplings soaked in rose-cardamom syrup.",              "veg": True,  "spicy": False},
    {"cat": "desserts", "name": "Mango Panna Cotta",    "emoji": "🍨", "price": 149, "desc": "Silky Italian dessert with fresh Alphonso mango coulis.",          "veg": True,  "spicy": False},
    {"cat": "drinks",   "name": "Fresh Lime Soda",      "emoji": "🥤", "price": 79,  "desc": "Chilled sparkling lime soda with a hint of mint.",                 "veg": True,  "spicy": False},
    {"cat": "drinks",   "name": "Mango Lassi",          "emoji": "🥭", "price": 99,  "desc": "Creamy blended yoghurt with real Alphonso mangoes.",               "veg": True,  "spicy": False},
    {"cat": "drinks",   "name": "Cold Coffee",          "emoji": "☕", "price": 129, "desc": "Blended iced coffee with a shot of espresso.",                     "veg": True,  "spicy": False},
    {"cat": "drinks",   "name": "Virgin Mojito",        "emoji": "🍹", "price": 119, "desc": "Fresh mint, lime & soda — the ultimate refresher.",               "veg": True,  "spicy": False},
]

SEED_RESTAURANT = {
    "id": "tap2dine",
    "name": "Tap2Dine Restaurant",
    "logo_emoji": "🍽️",
    "address": "123 Food Street, Mumbai",
    "phone": "+91 98765 43210",
    "currency": "INR",
    "tax_percent": 5.0,
}


def _seed(session: Session):
    """Seed default restaurant and menu if DB is empty."""
    if not session.get(RestaurantORM, "tap2dine"):
        session.add(RestaurantORM(**SEED_RESTAURANT))
        for item in SEED_MENU:
            session.add(MenuItemORM(restaurant_id="tap2dine", **item))
        session.commit()


def init_db():
    """Create all tables and seed initial data."""
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as s:
        _seed(s)


# ── HELPER: row → dict ────────────────────────────────────────────────────────
def _menu_to_dict(row: MenuItemORM) -> dict:
    return {
        "id": row.id, "cat": row.cat, "name": row.name, "emoji": row.emoji,
        "price": row.price, "desc": row.desc, "veg": row.veg, "spicy": row.spicy,
        "restaurant_id": row.restaurant_id,
    }


def _order_to_dict(row: OrderORM) -> dict:
    return {
        "id": row.id,
        "table": row.table_no,
        "items": json.loads(row.items_json),
        "subtotal": row.subtotal,
        "tax": row.tax,
        "total": row.total,
        "note": row.note,
        "status": row.status,
        "payment_method": row.payment_method,
        "restaurant_id": row.restaurant_id,
        "time": row.created_at.strftime("%I:%M %p") if row.created_at else "",
        "timestamp": row.created_at.isoformat() if row.created_at else "",
    }


def _reservation_to_dict(row: ReservationORM) -> dict:
    return {
        "id": row.id,
        "restaurant_id": row.restaurant_id,
        "name": row.name,
        "phone": row.phone,
        "email": row.email,
        "date": row.date,
        "time": row.time,
        "guests": row.guests,
        "table_pref": row.table_pref,
        "special_requests": row.special_requests,
        "status": row.status,
        "created_at": row.created_at.isoformat() if row.created_at else "",
    }


def _split_to_dict(row: BillSplitORM) -> dict:
    return {
        "id": row.id,
        "order_id": row.order_id,
        "split_type": row.split_type,
        "guests": json.loads(row.guests_json),
        "created_at": row.created_at.isoformat() if row.created_at else "",
    }


def _feedback_to_dict(row: FeedbackORM) -> dict:
    return {
        "id": row.id,
        "restaurant_id": row.restaurant_id,
        "table_no": row.table_no,
        "rating": row.rating,
        "comment": row.comment,
        "created_at": row.created_at.isoformat() if row.created_at else "",
    }


# ── DATABASE API ──────────────────────────────────────────────────────────────
class Database:
    """Thin façade over SQLAlchemy for use in main.py (same interface as before)."""

    # ── RESTAURANTS ──────────────────────────────────────────────────────────
    def get_restaurants(self) -> list:
        with SessionLocal() as s:
            rows = s.query(RestaurantORM).all()
            return [
                {"id": r.id, "name": r.name, "logo_emoji": r.logo_emoji,
                 "address": r.address, "phone": r.phone, "currency": r.currency,
                 "tax_percent": r.tax_percent}
                for r in rows
            ]

    def get_restaurant(self, rid: str) -> dict | None:
        with SessionLocal() as s:
            r = s.get(RestaurantORM, rid)
            if not r:
                return None
            return {"id": r.id, "name": r.name, "logo_emoji": r.logo_emoji,
                    "address": r.address, "phone": r.phone, "currency": r.currency,
                    "tax_percent": r.tax_percent}

    def create_restaurant(self, data: dict) -> dict:
        with SessionLocal() as s:
            row = RestaurantORM(**data)
            s.add(row)
            s.commit()
            s.refresh(row)
            return {"id": row.id, "name": row.name, "logo_emoji": row.logo_emoji,
                    "address": row.address, "phone": row.phone}

    # ── MENU ─────────────────────────────────────────────────────────────────
    def get_menu(self, restaurant_id: str = "tap2dine") -> list:
        with SessionLocal() as s:
            rows = s.query(MenuItemORM).filter_by(restaurant_id=restaurant_id).all()
            return [_menu_to_dict(r) for r in rows]

    def add_menu_item(self, item: dict) -> dict:
        with SessionLocal() as s:
            row = MenuItemORM(**item)
            s.add(row)
            s.commit()
            s.refresh(row)
            return _menu_to_dict(row)

    def delete_menu_item(self, item_id: int) -> bool:
        with SessionLocal() as s:
            row = s.get(MenuItemORM, item_id)
            if not row:
                return False
            s.delete(row)
            s.commit()
            return True

    # ── ORDERS ───────────────────────────────────────────────────────────────
    _order_counter: int = 1   # Tracks sequence (uses DB count on startup)

    def _next_order_id(self, session: Session) -> str:
        count = session.query(func.count(OrderORM.id)).scalar() + 1
        return f"T2D-{str(count).zfill(4)}"

    def place_order(self, data: dict) -> dict:
        with SessionLocal() as s:
            oid = self._next_order_id(s)
            row = OrderORM(
                id=oid,
                restaurant_id=data.get("restaurant_id", "tap2dine"),
                table_no=data["table"],
                items_json=json.dumps(data["items"]),
                subtotal=data["subtotal"],
                tax=data["tax"],
                total=data["total"],
                note=data.get("note", ""),
                payment_method=data.get("payment_method", "online"),
                razorpay_order_id=data.get("razorpay_order_id", ""),
                razorpay_payment_id=data.get("razorpay_payment_id", ""),
                status="Pending",
                created_at=datetime.utcnow(),
            )
            s.add(row)
            s.commit()
            s.refresh(row)
            return _order_to_dict(row)

    def get_orders(self, restaurant_id: str = None) -> list:
        with SessionLocal() as s:
            q = s.query(OrderORM).order_by(OrderORM.created_at.desc())
            if restaurant_id:
                q = q.filter_by(restaurant_id=restaurant_id)
            return [_order_to_dict(r) for r in q.all()]

    def update_order_status(self, order_id: str, status: str) -> dict | None:
        with SessionLocal() as s:
            row = s.get(OrderORM, order_id)
            if not row:
                return None
            row.status = status
            s.commit()
            s.refresh(row)
            return _order_to_dict(row)

    def clear_orders(self, restaurant_id: str = None):
        with SessionLocal() as s:
            q = s.query(OrderORM)
            if restaurant_id:
                q = q.filter_by(restaurant_id=restaurant_id)
            q.delete()
            s.commit()

    # ── STATS ────────────────────────────────────────────────────────────────
    def get_stats(self, restaurant_id: str = None) -> dict:
        orders = self.get_orders(restaurant_id)
        total_revenue = sum(o["total"] for o in orders)
        total_orders  = len(orders)
        avg_order     = round(total_revenue / total_orders) if total_orders else 0

        status_counts = {"Pending": 0, "Preparing": 0, "Ready": 0, "Delivered": 0}
        item_counts   = {}
        table_stats   = {}

        for order in orders:
            sc = order["status"]
            status_counts[sc] = status_counts.get(sc, 0) + 1

            t = str(order["table"])
            if t not in table_stats:
                table_stats[t] = {"orders": 0, "revenue": 0}
            table_stats[t]["orders"]  += 1
            table_stats[t]["revenue"] += order["total"]

            for item in order["items"]:
                key = item["name"]
                item_counts[key] = item_counts.get(key, 0) + item["qty"]

        top_items = sorted(item_counts.items(), key=lambda x: x[1], reverse=True)[:6]

        return {
            "total_revenue":   total_revenue,
            "total_orders":    total_orders,
            "avg_order_value": avg_order,
            "status_counts":   status_counts,
            "top_items":       [{"name": k, "count": v} for k, v in top_items],
            "table_stats":     table_stats,
        }

    # ── RESERVATIONS ─────────────────────────────────────────────────────────
    def create_reservation(self, data: dict) -> dict:
        with SessionLocal() as s:
            row = ReservationORM(
                restaurant_id=data.get("restaurant_id", "tap2dine"),
                name=data["name"],
                phone=data["phone"],
                email=data.get("email", ""),
                date=data["date"],
                time=data["time"],
                guests=data["guests"],
                table_pref=data.get("table_pref", "any"),
                special_requests=data.get("special_requests", ""),
                status="Pending",
                created_at=datetime.utcnow(),
            )
            s.add(row)
            s.commit()
            s.refresh(row)
            return _reservation_to_dict(row)

    def get_reservations(self, restaurant_id: str = None, date: str = None, status: str = None) -> list:
        with SessionLocal() as s:
            q = s.query(ReservationORM).order_by(ReservationORM.date, ReservationORM.time)
            if restaurant_id:
                q = q.filter_by(restaurant_id=restaurant_id)
            if date:
                q = q.filter_by(date=date)
            if status:
                q = q.filter_by(status=status)
            return [_reservation_to_dict(r) for r in q.all()]

    def update_reservation_status(self, res_id: int, status: str) -> dict | None:
        with SessionLocal() as s:
            row = s.get(ReservationORM, res_id)
            if not row:
                return None
            row.status = status
            s.commit()
            s.refresh(row)
            return _reservation_to_dict(row)

    # ── BILL SPLITS ──────────────────────────────────────────────────────────
    def create_split(self, order_id: str, split_type: str, guests: list) -> dict:
        with SessionLocal() as s:
            # Remove any existing split for this order
            s.query(BillSplitORM).filter_by(order_id=order_id).delete()
            row = BillSplitORM(
                order_id=order_id,
                split_type=split_type,
                guests_json=json.dumps(guests),
                created_at=datetime.utcnow(),
            )
            s.add(row)
            s.commit()
            s.refresh(row)
            return _split_to_dict(row)

    def get_split(self, order_id: str) -> dict | None:
        with SessionLocal() as s:
            row = s.query(BillSplitORM).filter_by(order_id=order_id).first()
            return _split_to_dict(row) if row else None

    def mark_split_paid(self, order_id: str, guest_idx: int) -> dict | None:
        with SessionLocal() as s:
            row = s.query(BillSplitORM).filter_by(order_id=order_id).first()
            if not row:
                return None
            guests = json.loads(row.guests_json)
            if guest_idx < 0 or guest_idx >= len(guests):
                return None
            guests[guest_idx]["paid"] = True
            row.guests_json = json.dumps(guests)
            s.commit()
            s.refresh(row)
            return _split_to_dict(row)

    # ── FEEDBACK ─────────────────────────────────────────────────────────────
    def add_feedback(self, data: dict) -> dict:
        with SessionLocal() as s:
            row = FeedbackORM(
                restaurant_id=data.get("restaurant_id", "tap2dine"),
                table_no=data.get("table_no", ""),
                rating=data["rating"],
                comment=data.get("comment", ""),
                created_at=datetime.utcnow(),
            )
            s.add(row)
            s.commit()
            s.refresh(row)
            return _feedback_to_dict(row)

    def get_feedback(self, restaurant_id: str = "tap2dine") -> list:
        with SessionLocal() as s:
            rows = (
                s.query(FeedbackORM)
                .filter_by(restaurant_id=restaurant_id)
                .order_by(FeedbackORM.created_at.desc())
                .all()
            )
            return [_feedback_to_dict(r) for r in rows]

    def get_feedback_summary(self, restaurant_id: str = "tap2dine") -> dict:
        with SessionLocal() as s:
            rows = (
                s.query(FeedbackORM)
                .filter_by(restaurant_id=restaurant_id)
                .order_by(FeedbackORM.created_at.desc())
                .all()
            )
            if not rows:
                return {"avg_rating": 0.0, "count": 0, "recent": []}
            avg = round(sum(r.rating for r in rows) / len(rows), 1)
            recent = [_feedback_to_dict(r) for r in rows[:5]]
            return {"avg_rating": avg, "count": len(rows), "recent": recent}

    # ── REVENUE ANALYTICS ────────────────────────────────────────────────────
    def get_revenue_stats(self, restaurant_id: str = "tap2dine") -> dict:
        with SessionLocal() as s:
            q = s.query(OrderORM).filter_by(restaurant_id=restaurant_id)
            all_orders = q.all()

            now = datetime.utcnow()
            today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            week_start  = today_start - timedelta(days=today_start.weekday())
            month_start = today_start.replace(day=1)

            total_revenue = sum(o.total for o in all_orders)
            revenue_today = sum(
                o.total for o in all_orders
                if o.created_at and o.created_at >= today_start
            )
            revenue_week = sum(
                o.total for o in all_orders
                if o.created_at and o.created_at >= week_start
            )
            revenue_month = sum(
                o.total for o in all_orders
                if o.created_at and o.created_at >= month_start
            )

            # Daily revenue for last 7 days
            daily_revenue = []
            for i in range(6, -1, -1):
                day = today_start - timedelta(days=i)
                next_day = day + timedelta(days=1)
                rev = sum(
                    o.total for o in all_orders
                    if o.created_at and day <= o.created_at < next_day
                )
                daily_revenue.append({
                    "date": day.strftime("%b %d"),
                    "revenue": rev,
                })

            return {
                "total_revenue": total_revenue,
                "revenue_today": revenue_today,
                "revenue_this_week": revenue_week,
                "revenue_this_month": revenue_month,
                "daily_revenue": daily_revenue,
            }

    def get_peak_hours(self, restaurant_id: str = "tap2dine") -> dict:
        with SessionLocal() as s:
            orders = (
                s.query(OrderORM)
                .filter_by(restaurant_id=restaurant_id)
                .all()
            )
            hour_counts = {h: 0 for h in range(24)}
            for o in orders:
                if o.created_at:
                    hour_counts[o.created_at.hour] += 1

            peak_hours = [
                {"hour": h, "count": hour_counts[h]} for h in range(24)
            ]
            busiest = max(peak_hours, key=lambda x: x["count"])["hour"] if orders else 12
            return {"peak_hours": peak_hours, "busiest_hour": busiest}


# Singleton
db = Database()

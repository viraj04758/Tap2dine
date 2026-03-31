"""
In-memory database for Tap2Dine MVP.
Simple to swap out for PostgreSQL / MongoDB later — just replace this file.
"""
from datetime import datetime


# ── SEED MENU DATA ────────────────────────────────────────────────────────────
SEED_MENU = [
    {"id": 1,  "cat": "starters", "name": "Veg Spring Rolls",      "emoji": "🥢", "price": 149, "desc": "Crispy golden rolls stuffed with fresh veggies & herbs.", "veg": True,  "spicy": False},
    {"id": 2,  "cat": "starters", "name": "Chicken Tikka",          "emoji": "🍗", "price": 249, "desc": "Juicy marinated chicken tikka with mint chutney.",         "veg": False, "spicy": True},
    {"id": 3,  "cat": "starters", "name": "Paneer Chilli",          "emoji": "🧀", "price": 199, "desc": "Indo-Chinese tossed paneer cubes in tangy sauce.",         "veg": True,  "spicy": True},
    {"id": 4,  "cat": "starters", "name": "Bruschetta",             "emoji": "🥖", "price": 169, "desc": "Toasted bread with tomato, basil & garlic topping.",       "veg": True,  "spicy": False},
    {"id": 5,  "cat": "mains",    "name": "Butter Chicken",         "emoji": "🍲", "price": 329, "desc": "Creamy tomato-based curry with tender chicken pieces.",    "veg": False, "spicy": False},
    {"id": 6,  "cat": "mains",    "name": "Dal Makhani",            "emoji": "🥘", "price": 249, "desc": "Slow-cooked black lentils in rich butter & cream.",        "veg": True,  "spicy": False},
    {"id": 7,  "cat": "mains",    "name": "Veg Biryani",            "emoji": "🍚", "price": 279, "desc": "Aromatic basmati rice with seasonal vegetables & spices.", "veg": True,  "spicy": True},
    {"id": 8,  "cat": "mains",    "name": "Chicken Biryani",        "emoji": "🍛", "price": 349, "desc": "Royal biryani with dum-cooked succulent chicken pieces.",  "veg": False, "spicy": True},
    {"id": 9,  "cat": "mains",    "name": "Paneer Butter Masala",   "emoji": "🧆", "price": 289, "desc": "Soft paneer in velvety onion-tomato gravy.",               "veg": True,  "spicy": False},
    {"id": 10, "cat": "pizza",    "name": "Margherita",             "emoji": "🍕", "price": 299, "desc": "Classic pizza with fresh mozzarella, tomato & basil.",    "veg": True,  "spicy": False},
    {"id": 11, "cat": "pizza",    "name": "Pepperoni Fiesta",       "emoji": "🍕", "price": 399, "desc": "Loaded with pepperoni, jalapeños & three cheeses.",        "veg": False, "spicy": True},
    {"id": 12, "cat": "pizza",    "name": "Farm Fresh Veggie",      "emoji": "🍕", "price": 349, "desc": "Seasonal veggies on house tomato sauce & oregano.",        "veg": True,  "spicy": False},
    {"id": 13, "cat": "burgers",  "name": "Classic Beef Burger",    "emoji": "🍔", "price": 299, "desc": "Juicy beef patty with lettuce, tomato & special sauce.",   "veg": False, "spicy": False},
    {"id": 14, "cat": "burgers",  "name": "Crispy Veggie Burger",   "emoji": "🍔", "price": 219, "desc": "Golden veggie patty with coleslaw & chipotle mayo.",       "veg": True,  "spicy": False},
    {"id": 15, "cat": "burgers",  "name": "Spicy Chicken Burger",   "emoji": "🍔", "price": 269, "desc": "Fiery fried chicken with sriracha & pickled onions.",      "veg": False, "spicy": True},
    {"id": 16, "cat": "desserts", "name": "Chocolate Lava Cake",    "emoji": "🎂", "price": 179, "desc": "Warm choco-lava cake served with vanilla ice cream.",      "veg": True,  "spicy": False},
    {"id": 17, "cat": "desserts", "name": "Gulab Jamun",            "emoji": "🍮", "price": 99,  "desc": "Soft khoya dumplings soaked in rose-cardamom syrup.",      "veg": True,  "spicy": False},
    {"id": 18, "cat": "desserts", "name": "Mango Panna Cotta",      "emoji": "🍨", "price": 149, "desc": "Silky Italian dessert with fresh Alphonso mango coulis.",  "veg": True,  "spicy": False},
    {"id": 19, "cat": "drinks",   "name": "Fresh Lime Soda",        "emoji": "🥤", "price": 79,  "desc": "Chilled sparkling lime soda with a hint of mint.",         "veg": True,  "spicy": False},
    {"id": 20, "cat": "drinks",   "name": "Mango Lassi",            "emoji": "🥭", "price": 99,  "desc": "Creamy blended yoghurt with real Alphonso mangoes.",       "veg": True,  "spicy": False},
    {"id": 21, "cat": "drinks",   "name": "Cold Coffee",            "emoji": "☕", "price": 129, "desc": "Blended iced coffee with a shot of espresso.",             "veg": True,  "spicy": False},
    {"id": 22, "cat": "drinks",   "name": "Virgin Mojito",          "emoji": "🍹", "price": 119, "desc": "Fresh mint, lime & soda — the ultimate refresher.",       "veg": True,  "spicy": False},
]


class Database:
    """In-memory store. Replace methods here to swap in a real DB."""

    def __init__(self):
        self._menu: list   = [dict(item) for item in SEED_MENU]
        self._orders: list = []
        self._order_counter: int = 1
        self._next_menu_id: int = 100  # custom items start at 100

    # ── MENU ─────────────────────────────────────────────────────────────────
    def get_menu(self) -> list:
        return self._menu

    def add_menu_item(self, item: dict) -> dict:
        item["id"] = self._next_menu_id
        self._next_menu_id += 1
        self._menu.append(item)
        return item

    def delete_menu_item(self, item_id: int) -> bool:
        original_len = len(self._menu)
        self._menu = [i for i in self._menu if i["id"] != item_id]
        return len(self._menu) < original_len

    # ── ORDERS ───────────────────────────────────────────────────────────────
    def place_order(self, order_data: dict) -> dict:
        order_id = f"T2D-{str(self._order_counter).zfill(4)}"
        self._order_counter += 1

        order = {
            "id":        order_id,
            "table":     order_data["table"],
            "items":     order_data["items"],
            "subtotal":  order_data["subtotal"],
            "tax":       order_data["tax"],
            "total":     order_data["total"],
            "note":      order_data.get("note", ""),
            "status":    "Pending",
            "time":      datetime.now().strftime("%I:%M %p"),
            "timestamp": datetime.now().isoformat(),
        }
        self._orders.append(order)
        return order

    def get_orders(self) -> list:
        # Return newest first
        return list(reversed(self._orders))

    def update_order_status(self, order_id: str, status: str) -> dict | None:
        for order in self._orders:
            if order["id"] == order_id:
                order["status"] = status
                return order
        return None

    def clear_orders(self):
        self._orders = []
        self._order_counter = 1

    # ── STATS ────────────────────────────────────────────────────────────────
    def get_stats(self) -> dict:
        orders = self._orders
        total_revenue = sum(o["total"] for o in orders)
        total_orders  = len(orders)
        avg_order     = round(total_revenue / total_orders) if total_orders else 0

        status_counts = {"Pending": 0, "Preparing": 0, "Ready": 0, "Delivered": 0}
        item_counts   = {}
        table_stats   = {}

        for order in orders:
            status_counts[order["status"]] = status_counts.get(order["status"], 0) + 1

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
            "total_revenue":  total_revenue,
            "total_orders":   total_orders,
            "avg_order_value": avg_order,
            "status_counts":  status_counts,
            "top_items":      [{"name": k, "count": v} for k, v in top_items],
            "table_stats":    table_stats,
        }


# Singleton instance — import this in main.py
db = Database()

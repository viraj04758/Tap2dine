# Tap2Dine 🍽️

> A QR-based restaurant ordering system — Scan, browse, order. No waiter needed for basics.

---

## 📁 Project Structure

```
Tap2Dine/
├── index.html        — Customer menu (scan QR → this page)
├── style.css         — Customer menu styles
├── app.js            — Menu, cart, order logic, WebSocket live status
├── admin.html        — Admin panel (Orders, Kitchen, Menu Manager, Analytics)
├── admin.css         — Admin panel styles
├── admin.js          — Admin logic, WebSocket real-time updates
├── qr.html           — QR Code generator for each table
├── backend/
│   ├── main.py       — FastAPI routes + WebSocket hub
│   ├── database.py   — In-memory DB (swap-ready for PostgreSQL)
│   ├── models.py     — Pydantic schemas
│   ├── requirements.txt
│   └── start.bat     — One-click Windows launcher
└── README.md
```

---

## 🚀 How to Run

### 1. Install dependencies (first time only)
```bash
cd backend
pip install -r requirements.txt
```

### 2. Start the API server
```bash
# Windows — double-click or run:
cd backend && python main.py

# Or with uvicorn directly:
uvicorn main:app --reload --port 8000
```

### 3. Open the app
| Page | URL |
|------|-----|
| Customer menu (Table 4) | http://localhost:8000/static/index.html?table=4 |
| Admin panel | http://localhost:8000/static/admin.html |
| QR Generator | http://localhost:8000/static/qr.html |
| API docs (Swagger) | http://localhost:8000/docs |

---

## 🔗 Table-Specific QR URLs

Each table gets a unique URL:
```
index.html?table=1
index.html?table=2
...
```
Open `qr.html` to generate & download QR codes for every table.

---

## 🔥 Features

| Feature | Status |
|---------|--------|
| QR-based table detection | ✅ |
| Category-filtered menu | ✅ |
| Cart (add / remove qty) | ✅ |
| Order placement → FastAPI backend | ✅ |
| GST auto-calculation (5%) | ✅ |
| Admin — Live Orders | ✅ |
| Admin — Kitchen Board (Kanban) | ✅ |
| Admin — Menu Manager | ✅ |
| Admin — Analytics (revenue, top items) | ✅ |
| QR Code Generator | ✅ |
| **WebSocket real-time updates** | ✅ |
| **Live status banner (customer)** | ✅ |
| **🔔 Call Waiter — reason picker modal** | ✅ |
| **Admin — Waiter Call Queue panel** | ✅ |
| **Admin instant order notifications + sound** | ✅ |
| **Analytics auto-refresh (30s)** | ✅ |
| **🛒 Mobile sticky cart bar** | ✅ |
| **📋 Session order history** | ✅ |
| **🔥 Popular / Trending strip** | ✅ |
| **💡 Smart recommendations strip** | ✅ |
| **PWA (installable on phones)** | ✅ |

---

## 🏗️ Architecture

```
Customer (Browser)
  └── index.html?table=N
        ├── Fetches menu from GET /api/menu
        ├── Manages cart in memory
        ├── Posts order to POST /api/orders
        ├── WebSocket /ws — receives live status changes
        └── 🔔 Call Waiter → POST /api/waiter-call

FastAPI Backend (localhost:8000)
  ├── GET    /api/menu           — list all items
  ├── POST   /api/menu           — add item (admin)
  ├── DELETE /api/menu/{id}      — delete item (admin)
  ├── POST   /api/orders         — place new order
  ├── GET    /api/orders         — list orders (filterable)
  ├── PATCH  /api/orders/{id}    — update order status
  ├── DELETE /api/orders         — clear all orders
  ├── GET    /api/orders/stats   — analytics
  ├── POST   /api/waiter-call    — notify waiter
  └── WS     /ws                 — real-time event hub

Admin (Browser)
  └── admin.html
        ├── Fetches orders / menu via REST API
        ├── WebSocket /ws — instant alerts (new orders, waiter calls)
        ├── Plays soft ping sound on new order
        └── Shows live WS connection indicator
```

---

## 📡 WebSocket Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `new_order` | Server → All | Full order object |
| `order_status_changed` | Server → All | Updated order object |
| `orders_cleared` | Server → All | `{}` |
| `menu_updated` | Server → All | `{action, item}` |
| `waiter_call` | Server → All | `{table, reason}` |

---

## 🛣️ Roadmap (Next)

- [ ] PostgreSQL / MongoDB for persistent orders
- [ ] Razorpay / Stripe payment integration
- [ ] AI recommendations 🤖
- [ ] Table booking / reservation system
- [ ] Multi-restaurant SaaS
- [ ] Bill splitting between table guests
- [x] PWA (installable on phones)

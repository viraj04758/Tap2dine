# PRD: Analytics Dashboard + Customer Loyalty System for Tap2Dine

## Overview
Extend Tap2Dine with a rich analytics dashboard for restaurant owners and a
customer loyalty/feedback system for diners. These features will make Tap2Dine
viable as a production SaaS product.

## Tech Stack
- Backend: FastAPI (Python) — existing `main.py` / `database.py` / `models.py`
- Database: SQLite (existing `tap2dine.db` via `database.py`)
- Frontend: Vanilla HTML/CSS/JS (existing pattern in `admin.html`, `index.html`)
- Real-time: WebSocket via existing `ConnectionManager`

## Features

### 1. Revenue Analytics API
- New endpoint `GET /api/analytics/revenue` returning:
  - total_revenue (all-time)
  - revenue_today
  - revenue_this_week
  - revenue_this_month
  - daily_revenue[] (last 7 days)
- Calculated from existing orders table + item prices

### 2. Peak Hours Heatmap API
- New endpoint `GET /api/analytics/peak-hours`
- Returns order count grouped by hour of day (0-23)
- Helps restaurant know their busiest periods

### 3. Customer Feedback System
- New DB table: `feedback` (id, restaurant_id, table_no, rating 1-5, comment, created_at)
- New endpoint `POST /api/feedback` — submit feedback
- New endpoint `GET /api/feedback` — list feedback (admin)
- New endpoint `GET /api/analytics/feedback-summary` — avg rating, count, recent comments

### 4. Analytics Dashboard Page (analytics.html)
- New frontend page: `analytics.html`
- Shows: Revenue cards (today/week/month/all-time)
- Shows: Peak hours bar chart (using Chart.js CDN)
- Shows: Average rating with stars
- Shows: Recent customer feedback list
- Linked from `admin.html` nav

### 5. Feedback Widget on Customer Menu Page
- Add a feedback form at the bottom of `index.html`
- Rating: 1-5 stars (click to select)
- Optional comment text area
- Submit button → POST /api/feedback
- Show thank-you message on success

## Acceptance Criteria (Global)
- All new endpoints return JSON
- All new DB tables created on `init_db()`
- No breaking changes to existing endpoints
- Frontend pages work with the existing backend on port 8000

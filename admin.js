// ── API CONFIG ────────────────────────────────────────────────────────────────
const API = 'http://localhost:8000/api';
const WS  = 'ws://localhost:8000/ws';

// ── TAB STATE ─────────────────────────────────────────────────────────────────
const TAB_META = {
  orders:    { title: 'Live Orders',   sub: 'Real-time incoming orders from all tables' },
  kitchen:   { title: 'Kitchen View',  sub: 'Incoming tickets by preparation stage' },
  menu:      { title: 'Menu Manager',  sub: 'Add, edit and remove menu items' },
  analytics: { title: 'Analytics',     sub: 'Revenue, order trends and popular items' },
};

let activeTab = 'orders';

// ── WAITER CALL QUEUE ─────────────────────────────────────────────────────────
let waiterCalls   = [];  // { id, table, reason, time }
let wcPanelOpen   = false;
let wcCallCounter = 0;

function switchTab(tab, btn) {
  activeTab = tab;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
  document.getElementById(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`).style.display = 'block';
  document.getElementById('tabTitle').textContent = TAB_META[tab].title;
  document.getElementById('tabSub').textContent   = TAB_META[tab].sub;

  if (tab === 'analytics') renderAnalytics();
  if (tab === 'kitchen')   renderKitchen();
  if (tab === 'menu')      loadMenuList();
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── WEBSOCKET: REAL-TIME UPDATES ─────────────────────────────────────────────
let ws;
let wsConnected = false;

function connectWS() {
  try {
    ws = new WebSocket(WS);

    ws.onopen = () => {
      wsConnected = true;
      updateWsIndicator(true);
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.event) {
        case 'new_order':
          // Flash notification + refresh relevant tabs
          flashNotification(`🆕 New order from Table ${msg.data.table}! #${msg.data.id}`);
          if (activeTab === 'orders')  renderOrders();
          if (activeTab === 'kitchen') renderKitchen();
          break;

        case 'order_status_changed':
          if (activeTab === 'orders')  renderOrders();
          if (activeTab === 'kitchen') renderKitchen();
          break;

        case 'orders_cleared':
          if (activeTab === 'orders')  renderOrders();
          if (activeTab === 'kitchen') renderKitchen();
          break;

        case 'menu_updated':
          if (activeTab === 'menu') loadMenuList();
          break;

        case 'waiter_call':
          addWaiterCall(msg.data);
          flashNotification(`🔔 Table ${msg.data.table}: ${msg.data.reason}`);
          break;
      }
    };

    ws.onclose = () => {
      wsConnected = false;
      updateWsIndicator(false);
      setTimeout(connectWS, 3000);
    };

    ws.onerror = () => ws.close();

  } catch (e) {
    // Fall back gracefully
  }
}

function updateWsIndicator(connected) {
  const dot  = document.getElementById('wsDot');
  const text = document.getElementById('wsText');
  if (!dot) return;
  dot.style.background  = connected ? '#10b981' : '#ef4444';
  text.textContent      = connected ? 'Live' : 'Reconnecting…';
}

function flashNotification(msg) {
  // Play a soft ping sound (best-effort)
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch (_) {}

  showToast(msg);
}

// ── ORDERS ────────────────────────────────────────────────────────────────────
async function fetchOrders() {
  try {
    const data = await apiFetch('/orders');
    return data.orders;
  } catch {
    return [];
  }
}

async function updateOrderStatus(orderId, status) {
  try {
    await apiFetch(`/orders/${orderId}`, {
      method: 'PATCH',
      body:   JSON.stringify({ status }),
    });
    showToast(`Order #${orderId} → ${status} ✓`);
    // WS broadcast will trigger re-render, but also do it immediately:
    renderOrders();
    renderKitchen();
  } catch (err) {
    showToast(`❌ ${err.message}`);
  }
}

async function clearAllOrders() {
  if (!confirm('Clear ALL orders? This cannot be undone.')) return;
  try {
    await apiFetch('/orders', { method: 'DELETE' });
    renderOrders();
    renderKitchen();
    showToast('All orders cleared.');
  } catch (err) {
    showToast(`❌ ${err.message}`);
  }
}

// ── RENDER ORDERS ─────────────────────────────────────────────────────────────
async function renderOrders() {
  const orders = await fetchOrders();
  const grid   = document.getElementById('ordersGrid');
  grid.innerHTML = '';

  // Stats
  const counts = { Pending: 0, Preparing: 0, Ready: 0, Delivered: 0 };
  orders.forEach(o => { if (o.status in counts) counts[o.status]++; });
  document.getElementById('statPending').textContent   = counts.Pending;
  document.getElementById('statPreparing').textContent = counts.Preparing;
  document.getElementById('statReady').textContent     = counts.Ready;
  document.getElementById('statDelivered').textContent = counts.Delivered;

  if (orders.length === 0) {
    grid.innerHTML = `<div class="empty-state"><span>📭</span><p>No orders yet.</p><small>Orders will appear here in real-time.</small></div>`;
    return;
  }

  orders.forEach(order => {
    const card = document.createElement('div');
    card.className = 'order-card';
    card.innerHTML = `
      <div class="order-card-header">
        <div>
          <div class="order-card-id">#${order.id}</div>
          <div class="order-card-time">${order.time}</div>
        </div>
        <div style="text-align:right;">
          <span class="status-pill status-${order.status}">${order.status}</span>
          <div class="order-card-table" style="margin-top:4px;">Table ${order.table}</div>
        </div>
      </div>
      <div class="order-card-items">
        ${order.items.map(i => `
          <div class="order-item-row">
            <span class="order-item-emoji">${i.emoji}</span>
            <span class="order-item-name">${i.name}</span>
            <span class="order-item-qty">×${i.qty}</span>
            <span class="order-item-sub">₹${i.price * i.qty}</span>
          </div>`).join('')}
      </div>
      ${order.note ? `<div class="order-note">📝 ${order.note}</div>` : ''}
      <div class="order-card-footer">
        <span class="order-total">₹${order.total}</span>
        <div class="status-btns">
          ${order.status === 'Pending'   ? `<button class="status-btn btn-preparing" onclick="updateOrderStatus('${order.id}','Preparing')">🔥 Preparing</button>` : ''}
          ${order.status === 'Preparing' ? `<button class="status-btn btn-ready"     onclick="updateOrderStatus('${order.id}','Ready')">✅ Ready</button>` : ''}
          ${order.status === 'Ready'     ? `<button class="status-btn btn-delivered" onclick="updateOrderStatus('${order.id}','Delivered')">🤝 Delivered</button>` : ''}
        </div>
      </div>`;
    grid.appendChild(card);
  });
}

// ── KITCHEN VIEW ──────────────────────────────────────────────────────────────
async function renderKitchen() {
  const orders = await fetchOrders();
  const cols   = { Pending: 'kitchenPending', Preparing: 'kitchenPreparing', Ready: 'kitchenReady' };

  Object.entries(cols).forEach(([status, elId]) => {
    const el   = document.getElementById(elId);
    const list = orders.filter(o => o.status === status);
    el.innerHTML = list.length === 0
      ? `<div class="kitchen-no-orders">No orders</div>`
      : list.map(o => `
          <div class="kitchen-ticket">
            <div class="kitchen-ticket-header">
              <span class="kitchen-ticket-table">Table ${o.table}</span>
              <span class="kitchen-ticket-time">${o.time}</span>
            </div>
            ${o.items.map(i => `<div class="kitchen-ticket-item">${i.emoji} ${i.name} ×${i.qty}</div>`).join('')}
            ${o.note ? `<div style="font-size:0.78rem;color:var(--muted);margin-top:8px;">📝 ${o.note}</div>` : ''}
          </div>`).join('');
  });
}

// ── MENU MANAGER ──────────────────────────────────────────────────────────────
async function loadMenuList() {
  try {
    const data = await apiFetch('/menu');
    renderMenuList(data.items);
  } catch {
    showToast('❌ Could not load menu from server.');
  }
}

function renderMenuList(items) {
  const list = document.getElementById('menuList');
  list.innerHTML = '';
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'menu-list-item';
    row.innerHTML = `
      <div class="menu-list-emoji">${item.emoji}</div>
      <div class="menu-list-info">
        <div class="menu-list-name">
          ${item.name}
          ${item.veg ? `<small style="color:var(--green);font-size:0.72rem;">●VEG</small>` : ''}
          ${item.spicy ? '🌶️' : ''}
        </div>
        <div class="menu-list-meta">${item.cat.charAt(0).toUpperCase() + item.cat.slice(1)} · ${item.desc.slice(0,50)}…</div>
      </div>
      <div class="menu-list-price">₹${item.price}</div>
      <button class="menu-delete-btn" onclick="deleteMenuItem(${item.id})" title="Delete">✕</button>`;
    list.appendChild(row);
  });
}

async function addMenuItem() {
  const name  = document.getElementById('newName').value.trim();
  const price = parseInt(document.getElementById('newPrice').value);
  const cat   = document.getElementById('newCat').value;
  const emoji = document.getElementById('newEmoji').value.trim() || '🍽️';
  const desc  = document.getElementById('newDesc').value.trim() || 'Freshly prepared just for you.';
  const veg   = document.getElementById('newVeg').checked;
  const spicy = document.getElementById('newSpicy').checked;

  if (!name || !price || isNaN(price)) {
    showToast('⚠️ Name and price are required!');
    return;
  }

  try {
    await apiFetch('/menu', {
      method: 'POST',
      body:   JSON.stringify({ name, emoji, price, cat, desc, veg, spicy }),
    });
    showToast(`✅ "${name}" added to menu!`);
    loadMenuList();
    ['newName', 'newPrice', 'newEmoji', 'newDesc'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('newVeg').checked   = true;
    document.getElementById('newSpicy').checked = false;
  } catch (err) {
    showToast(`❌ ${err.message}`);
  }
}

async function deleteMenuItem(id) {
  if (!confirm('Remove this item from the menu?')) return;
  try {
    await apiFetch(`/menu/${id}`, { method: 'DELETE' });
    showToast('Item removed from menu.');
    loadMenuList();
  } catch (err) {
    showToast(`❌ ${err.message}`);
  }
}

// ── ANALYTICS ────────────────────────────────────────────────────────────────
async function renderAnalytics() {
  try {
    const stats = await apiFetch('/orders/stats');

    document.getElementById('revTotal').textContent  = `₹${stats.total_revenue}`;
    document.getElementById('revOrders').textContent = stats.total_orders;
    document.getElementById('revAvg').textContent    = `₹${stats.avg_order_value}`;

    // Top items
    document.getElementById('topItems').innerHTML = stats.top_items.length === 0
      ? `<p style="color:var(--muted);font-size:0.85rem;">No data yet.</p>`
      : stats.top_items.map((item, i) => `
          <div class="top-item-row">
            <span class="top-item-rank">#${i + 1}</span>
            <span class="top-item-name">${item.name}</span>
            <span class="top-item-count">${item.count} orders</span>
          </div>`).join('');

    // Table stats
    const tableEntries = Object.entries(stats.table_stats).sort((a,b) => b[1].revenue - a[1].revenue);
    document.getElementById('tableStats').innerHTML = tableEntries.length === 0
      ? `<p style="color:var(--muted);font-size:0.85rem;">No data yet.</p>`
      : tableEntries.map(([table, data]) => `
          <div class="table-stat-row">
            <span class="table-num">Table ${table}</span>
            <span class="table-orders">${data.orders} orders</span>
            <span class="table-rev">₹${data.revenue}</span>
          </div>`).join('');

  } catch {
    showToast('❌ Could not load analytics.');
  }
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('adminToast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ── WAITER CALL QUEUE ─────────────────────────────────────────────────────────
function addWaiterCall(data) {
  wcCallCounter++;
  waiterCalls.unshift({
    id:     wcCallCounter,
    table:  data.table,
    reason: data.reason || 'Assistance needed',
    time:   new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
  });
  renderWaiterCalls();
  // Auto-open panel on first call
  if (!wcPanelOpen) openWaiterPanel();
}

function toggleWaiterPanel() {
  wcPanelOpen ? closeWaiterPanel() : openWaiterPanel();
}

function openWaiterPanel() {
  wcPanelOpen = true;
  document.getElementById('wcPanel').classList.add('open');
  // Clear badge when panel is opened
  const badge = document.getElementById('wcBadge');
  if (badge) badge.style.display = 'none';
}

function closeWaiterPanel() {
  wcPanelOpen = false;
  document.getElementById('wcPanel').classList.remove('open');
}

function dismissWaiterCall(id) {
  waiterCalls = waiterCalls.filter(c => c.id !== id);
  renderWaiterCalls();
}

function dismissAllWaiterCalls() {
  waiterCalls = [];
  renderWaiterCalls();
}

function renderWaiterCalls() {
  const list  = document.getElementById('wcList');
  const badge = document.getElementById('wcBadge');
  if (!list) return;

  // Update badge
  if (badge) {
    if (waiterCalls.length > 0 && !wcPanelOpen) {
      badge.style.display  = 'inline-flex';
      badge.textContent    = waiterCalls.length;
    } else {
      badge.style.display  = 'none';
    }
  }

  if (waiterCalls.length === 0) {
    list.innerHTML = '<p class="wc-empty">✅ No active calls</p>';
    return;
  }

  list.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
      <button onclick="dismissAllWaiterCalls()" style="
        background:rgba(231,76,60,0.1);border:1px solid rgba(231,76,60,0.3);
        color:#e74c3c;font-family:inherit;font-size:0.75rem;font-weight:600;
        padding:5px 12px;border-radius:50px;cursor:pointer;">Clear All</button>
    </div>
    ${waiterCalls.map(call => `
    <div class="wc-card" id="wc-${call.id}">
      <div class="wc-card-top">
        <div class="wc-table-badge">Table ${call.table}</div>
        <span class="wc-time">${call.time}</span>
      </div>
      <div class="wc-reason">${call.reason}</div>
      <button class="wc-dismiss" onclick="dismissWaiterCall(${call.id})">✓ Handled</button>
    </div>`).join('')}`;
}

// ── ANALYTICS AUTO-REFRESH ────────────────────────────────────────────────────
setInterval(() => {
  if (activeTab === 'analytics') {
    renderAnalytics();
  }
}, 30000);

// ── INIT ──────────────────────────────────────────────────────────────────────
// Connect WebSocket first, then initial render
connectWS();
renderOrders();

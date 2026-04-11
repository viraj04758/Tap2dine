// ── API CONFIG ────────────────────────────────────────────────────────────────
const API = 'http://localhost:8000/api';
const WS  = 'ws://localhost:8000/ws';

// ── TAB STATE ─────────────────────────────────────────────────────────────────
const TAB_META = {
  orders:       { title: 'Live Orders',    sub: 'Real-time incoming orders from all tables' },
  kitchen:      { title: 'Kitchen View',   sub: 'Incoming tickets by preparation stage' },
  menu:         { title: 'Menu Manager',   sub: 'Add, edit and remove menu items' },
  analytics:    { title: 'Analytics',      sub: 'Revenue, order trends and popular items' },
  reservations: { title: 'Reservations',   sub: 'Manage table bookings and guest requests' },
};

let activeTab = 'orders';

// ── WAITER CALL QUEUE ─────────────────────────────────────────────────────────
let waiterCalls   = [];
let wcPanelOpen   = false;
let wcCallCounter = 0;

function switchTab(tab, btn) {
  activeTab = tab;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
  document.getElementById(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`).style.display = 'block';
  document.getElementById('tabTitle').textContent = TAB_META[tab]?.title || tab;
  document.getElementById('tabSub').textContent   = TAB_META[tab]?.sub   || '';

  if (tab === 'analytics')    renderAnalytics();
  if (tab === 'kitchen')      renderKitchen();
  if (tab === 'menu')         loadMenuList();
  if (tab === 'reservations') loadReservations();
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

// ── WEBSOCKET ─────────────────────────────────────────────────────────────────
let ws;
let wsConnected = false;

function connectWS() {
  try {
    ws = new WebSocket(WS);

    ws.onopen = () => { wsConnected = true; updateWsIndicator(true); };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.event) {
        case 'new_order':
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
        case 'new_reservation':
          flashNotification(`📅 New booking: ${msg.data.name} (${msg.data.guests} guests) — ${msg.data.date}`);
          // Update badge
          const rb = document.getElementById('resBadge');
          if (rb) { rb.style.display = 'inline-flex'; rb.textContent = (parseInt(rb.textContent)||0)+1; }
          if (activeTab === 'reservations') loadReservations();
          break;
        case 'reservation_updated':
          if (activeTab === 'reservations') loadReservations();
          break;
        case 'bill_split_created':
          showToast(`💸 Bill split created for order #${msg.data.order_id}`);
          break;
        case 'new_feedback':
          showToast(`⭐ New ${msg.data.rating}-star review received!`);
          if (activeTab === 'analytics') renderAnalytics();
          break;
      }
    };

    ws.onclose = () => {
      wsConnected = false;
      updateWsIndicator(false);
      setTimeout(connectWS, 3000);
    };

    ws.onerror = () => ws.close();
  } catch (e) {}
}

function updateWsIndicator(connected) {
  const dot  = document.getElementById('wsDot');
  const text = document.getElementById('wsText');
  if (!dot) return;
  dot.style.background = connected ? '#10b981' : '#ef4444';
  text.textContent     = connected ? 'Live' : 'Reconnecting…';
}

function flashNotification(msg) {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4);
  } catch (_) {}
  showToast(msg);
}

// ── ORDERS ────────────────────────────────────────────────────────────────────
async function fetchOrders() {
  try { return (await apiFetch('/orders')).orders; } catch { return []; }
}

async function updateOrderStatus(orderId, status) {
  try {
    await apiFetch(`/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    showToast(`Order #${orderId} → ${status} ✓`);
    renderOrders(); renderKitchen();
  } catch (err) { showToast(`❌ ${err.message}`); }
}

async function clearAllOrders() {
  if (!confirm('Clear ALL orders? This cannot be undone.')) return;
  try {
    await apiFetch('/orders', { method: 'DELETE' });
    renderOrders(); renderKitchen();
    showToast('All orders cleared.');
  } catch (err) { showToast(`❌ ${err.message}`); }
}

async function renderOrders() {
  const orders = await fetchOrders();
  const grid   = document.getElementById('ordersGrid');
  grid.innerHTML = '';

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
          <button class="status-btn" style="background:rgba(249,115,22,0.12);color:#f97316;border:1px solid rgba(249,115,22,.3);"
            onclick="openSplitModal('${order.id}',${order.total})">💸 Split</button>
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
  } catch { showToast('❌ Could not load menu from server.'); }
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

  if (!name || !price || isNaN(price)) { showToast('⚠️ Name and price are required!'); return; }

  try {
    await apiFetch('/menu', { method: 'POST', body: JSON.stringify({ name, emoji, price, cat, desc, veg, spicy }) });
    showToast(`✅ "${name}" added to menu!`);
    loadMenuList();
    ['newName','newPrice','newEmoji','newDesc'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('newVeg').checked   = true;
    document.getElementById('newSpicy').checked = false;
  } catch (err) { showToast(`❌ ${err.message}`); }
}

async function deleteMenuItem(id) {
  if (!confirm('Remove this item from the menu?')) return;
  try {
    await apiFetch(`/menu/${id}`, { method: 'DELETE' });
    showToast('Item removed from menu.');
    loadMenuList();
  } catch (err) { showToast(`❌ ${err.message}`); }
}

// ── ANALYTICS ─────────────────────────────────────────────────────────────────
function fmtRev(n) {
  if (n >= 100000) return '₹' + (n / 100000).toFixed(1) + 'L';
  if (n >= 1000)   return '₹' + (n / 1000).toFixed(1) + 'k';
  return '₹' + n;
}

function starsStr(avg) {
  const full = Math.round(avg);
  let s = '';
  for (let i = 1; i <= 5; i++) s += i <= full ? '★' : '☆';
  return s;
}

async function renderAnalytics() {
  // ── Existing order stats ──────────────────────────────────────────────────
  try {
    const stats = await apiFetch('/orders/stats');
    document.getElementById('revTotal').textContent  = `₹${stats.total_revenue}`;
    document.getElementById('revOrders').textContent = stats.total_orders;
    document.getElementById('revAvg').textContent    = `₹${stats.avg_order_value}`;

    document.getElementById('topItems').innerHTML = stats.top_items.length === 0
      ? `<p style="color:var(--muted);font-size:0.85rem;">No data yet.</p>`
      : stats.top_items.map((item, i) => `
          <div class="top-item-row">
            <span class="top-item-rank">#${i + 1}</span>
            <span class="top-item-name">${item.name}</span>
            <span class="top-item-count">${item.count} orders</span>
          </div>`).join('');

    const tableEntries = Object.entries(stats.table_stats).sort((a,b) => b[1].revenue - a[1].revenue);
    document.getElementById('tableStats').innerHTML = tableEntries.length === 0
      ? `<p style="color:var(--muted);font-size:0.85rem;">No data yet.</p>`
      : tableEntries.map(([table, data]) => `
          <div class="table-stat-row">
            <span class="table-num">Table ${table}</span>
            <span class="table-orders">${data.orders} orders</span>
            <span class="table-rev">₹${data.revenue}</span>
          </div>`).join('');
  } catch { showToast('❌ Could not load analytics.'); }

  // ── Revenue cards ─────────────────────────────────────────────────────────
  try {
    const rev = await apiFetch('/analytics/revenue');
    document.getElementById('anToday').textContent = fmtRev(rev.revenue_today);
    document.getElementById('anWeek').textContent  = fmtRev(rev.revenue_this_week);
    document.getElementById('anMonth').textContent = fmtRev(rev.revenue_this_month);
    document.getElementById('anTotal').textContent = fmtRev(rev.total_revenue);
  } catch { /* non-critical */ }

  // ── Feedback summary ──────────────────────────────────────────────────────
  try {
    const fb = await apiFetch('/analytics/feedback-summary');
    document.getElementById('adminFbAvg').textContent   = fb.count ? fb.avg_rating.toFixed(1) : '—';
    document.getElementById('adminFbStars').textContent = fb.count ? starsStr(fb.avg_rating) : '☆☆☆☆☆';
    document.getElementById('adminFbCount').textContent = fb.count
      ? `${fb.count} review${fb.count !== 1 ? 's' : ''}`
      : 'No reviews yet';

    const list = document.getElementById('adminFbList');
    if (!fb.recent || fb.recent.length === 0) {
      list.innerHTML = '<p style="color:var(--muted);font-size:.88rem;">No feedback yet.</p>';
    } else {
      list.innerHTML = fb.recent.map(r => `
        <div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
            <span style="color:#f97316;font-size:.95rem;">${starsStr(r.rating)}</span>
            <span style="font-size:.75rem;color:var(--muted);">
              ${r.table_no ? 'Table ' + r.table_no + ' · ' : ''}
              ${new Date(r.created_at).toLocaleDateString('en-IN', {day:'numeric',month:'short'})}
            </span>
          </div>
          ${r.comment ? `<p style="font-size:.88rem;color:var(--text);margin:0;">"${r.comment}"</p>` : '<p style="font-size:.82rem;color:var(--muted);margin:0;font-style:italic;">No comment.</p>'}
        </div>`).join('');
    }
  } catch { /* non-critical */ }
}

// ── RESERVATIONS ──────────────────────────────────────────────────────────────
async function loadReservations() {
  const dateFilter   = document.getElementById('resDateFilter')?.value || '';
  const statusFilter = document.getElementById('resStatusFilter')?.value || '';
  const list         = document.getElementById('reservationsList');
  if (!list) return;

  try {
    let url = '/reservations?restaurant_id=tap2dine';
    if (dateFilter)   url += `&date=${encodeURIComponent(dateFilter)}`;
    if (statusFilter) url += `&status=${encodeURIComponent(statusFilter)}`;

    const data  = await apiFetch(url);
    const items = data.reservations;

    // Update stats
    const counts = { Pending: 0, Confirmed: 0, Cancelled: 0 };
    items.forEach(r => { if (r.status in counts) counts[r.status]++; });
    document.getElementById('resPending').textContent   = counts.Pending;
    document.getElementById('resConfirmed').textContent = counts.Confirmed;
    document.getElementById('resCancelled').textContent = counts.Cancelled;
    document.getElementById('resTotal').textContent     = items.length;

    // Clear reservation badge
    const rb = document.getElementById('resBadge');
    if (rb) rb.style.display = 'none';

    if (items.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <span>📅</span>
          <p>No reservations found.</p>
          <small>${dateFilter ? 'Try a different date or clear the filter.' : 'Bookings made via the reservation page will appear here.'}</small>
        </div>`;
      return;
    }

    list.innerHTML = items.map(r => {
      const statusColors = {
        Pending:   { bg: 'rgba(249,115,22,.12)',  text: '#f97316' },
        Confirmed: { bg: 'rgba(34,197,94,.12)',   text: '#22c55e' },
        Cancelled: { bg: 'rgba(239,68,68,.12)',   text: '#ef4444' },
        Completed: { bg: 'rgba(99,102,241,.12)',  text: '#818cf8' },
        'No-show': { bg: 'rgba(156,163,175,.12)', text: '#9ca3af' },
      };
      const sc = statusColors[r.status] || statusColors.Pending;
      const [yy, mm, dd] = r.date.split('-');
      const dateStr = `${dd}/${mm}/${yy}`;
      const time12  = (() => {
        const [h, m] = r.time.split(':').map(Number);
        const ampm = h >= 12 ? 'PM' : 'AM';
        return `${h > 12 ? h - 12 : h || 12}:${String(m).padStart(2,'0')} ${ampm}`;
      })();

      return `
        <div style="background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px 22px;margin-bottom:12px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;">
          <!-- Date block -->
          <div style="background:var(--bar-bg);border-radius:12px;padding:12px 16px;text-align:center;min-width:64px;flex-shrink:0;">
            <div style="font-size:1.5rem;font-weight:800;line-height:1;">${dd}</div>
            <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;">${new Date(r.date+'T00:00:00').toLocaleString('en',{month:'short'})}</div>
            <div style="font-size:0.78rem;color:var(--accent2);font-weight:600;margin-top:4px;">${time12}</div>
          </div>
          <!-- Info -->
          <div style="flex:1;min-width:160px;">
            <div style="font-size:1rem;font-weight:700;margin-bottom:4px;">${r.name}</div>
            <div style="font-size:0.82rem;color:var(--muted);margin-bottom:2px;">📞 ${r.phone}${r.email ? ' · ' + r.email : ''}</div>
            <div style="font-size:0.82rem;color:var(--muted);margin-bottom:2px;">👥 ${r.guests} guests · 🪑 ${r.table_pref || 'Any'}</div>
            ${r.special_requests ? `<div style="font-size:0.78rem;color:var(--muted);margin-top:6px;font-style:italic;">💬 ${r.special_requests}</div>` : ''}
          </div>
          <!-- Status + Actions -->
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0;">
            <span style="padding:5px 14px;border-radius:50px;font-size:0.75rem;font-weight:700;background:${sc.bg};color:${sc.text};">${r.status}</span>
            <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
              ${r.status === 'Pending' ? `
                <button onclick="updateReservation(${r.id},'Confirmed')" style="${btnStyle('#22c55e')}">✅ Confirm</button>
                <button onclick="updateReservation(${r.id},'Cancelled')" style="${btnStyle('#ef4444')}">✕ Cancel</button>` : ''}
              ${r.status === 'Confirmed' ? `
                <button onclick="updateReservation(${r.id},'Completed')" style="${btnStyle('#818cf8')}">🏁 Complete</button>
                <button onclick="updateReservation(${r.id},'No-show')"   style="${btnStyle('#9ca3af')}">🚫 No-show</button>` : ''}
            </div>
            <div style="font-size:0.72rem;color:var(--muted);">REF: RES-${String(r.id).padStart(4,'0')}</div>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><span>⚠️</span><p>${err.message}</p></div>`;
  }
}

function btnStyle(color) {
  return `padding:6px 14px;border-radius:8px;border:1px solid ${color}33;background:${color}18;color:${color};font-size:0.78rem;font-weight:700;font-family:inherit;cursor:pointer;transition:opacity .15s;`;
}

async function updateReservation(id, status) {
  try {
    await apiFetch(`/reservations/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    showToast(`Reservation RES-${String(id).padStart(4,'0')} → ${status}`);
    loadReservations();
  } catch (err) { showToast(`❌ ${err.message}`); }
}

// ── BILL SPLIT MODAL ──────────────────────────────────────────────────────────
let _splitOrderId   = null;
let _splitTotal     = 0;
let _splitGuestCount = 2;
let _splitType      = 'equal';

function openSplitModal(orderId, total) {
  _splitOrderId    = orderId;
  _splitTotal      = total;
  _splitGuestCount = 2;
  _splitType       = 'equal';
  document.getElementById('splitOrderLabel').textContent = `Order #${orderId} · Total ₹${total}`;
  document.getElementById('splitGuestCount').textContent = _splitGuestCount;
  document.querySelectorAll('.split-type-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('btnEqualSplit').classList.add('active');
  renderSplitRows();
  const modal = document.getElementById('splitModal');
  modal.style.display = 'flex';
}

function closeSplitModalOutside(e) {
  if (e.target.id === 'splitModal') document.getElementById('splitModal').style.display = 'none';
}

function setSplitType(type, btn) {
  _splitType = type;
  document.querySelectorAll('.split-type-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderSplitRows();
}

function changeSplitGuests(delta) {
  _splitGuestCount = Math.max(2, Math.min(10, _splitGuestCount + delta));
  document.getElementById('splitGuestCount').textContent = _splitGuestCount;
  renderSplitRows();
}

function renderSplitRows() {
  const container = document.getElementById('splitGuestRows');
  const perPerson  = Math.ceil(_splitTotal / _splitGuestCount);
  const rows = [];
  for (let i = 0; i < _splitGuestCount; i++) {
    const amount = _splitType === 'equal' ? perPerson : 0;
    rows.push(`
      <div style="display:flex;align-items:center;gap:10px;background:var(--bar-bg);border:1px solid var(--border);border-radius:10px;padding:10px 14px;">
        <span style="font-size:1.1rem;">👤</span>
        <input placeholder="Guest ${i+1} name" id="split-name-${i}"
          style="flex:1;background:transparent;border:none;color:var(--text);font-family:inherit;font-size:.9rem;outline:none;" />
        <span style="color:var(--muted);font-size:.85rem;">₹</span>
        <input type="number" id="split-amt-${i}" value="${amount}" min="0"
          style="width:72px;background:transparent;border:none;color:var(--accent2);font-family:inherit;font-size:.9rem;font-weight:700;text-align:right;outline:none;"
          ${_splitType === 'equal' ? 'readonly' : ''} />
      </div>`);
  }
  container.innerHTML = rows.join('');
}

async function confirmBillSplit() {
  const guests = [];
  for (let i = 0; i < _splitGuestCount; i++) {
    const name   = document.getElementById(`split-name-${i}`)?.value.trim() || `Guest ${i+1}`;
    const amount = parseInt(document.getElementById(`split-amt-${i}`)?.value) || 0;
    guests.push({ name, amount, paid: false });
  }

  if (_splitType === 'custom') {
    const total = guests.reduce((s,g) => s + g.amount, 0);
    if (total !== _splitTotal) {
      showToast(`⚠️ Total ₹${total} doesn't match order ₹${_splitTotal}`);
      return;
    }
  }

  try {
    await apiFetch(`/orders/${_splitOrderId}/split`, {
      method: 'POST',
      body: JSON.stringify({ order_id: _splitOrderId, guests, split_type: _splitType }),
    });
    showToast(`✅ Bill split created for #${_splitOrderId}`);
    document.getElementById('splitModal').style.display = 'none';
    // Show the split plan
    viewSplitPlan(_splitOrderId);
  } catch (err) { showToast(`❌ ${err.message}`); }
}

async function viewSplitPlan(orderId) {
  try {
    const split = await apiFetch(`/orders/${orderId}/split`);
    const guests = split.guests;
    const html = guests.map((g, i) => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">
        <span>${g.paid ? '✅' : '⏳'}</span>
        <span style="flex:1;font-weight:600;">${g.name}</span>
        <span style="color:var(--accent2);font-weight:700;">₹${g.amount}</span>
        ${!g.paid ? `<button onclick="markGuestPaid('${orderId}',${i})"
          style="padding:5px 12px;border-radius:8px;border:1px solid #22c55e33;background:#22c55e18;color:#22c55e;font-size:.75rem;font-weight:700;font-family:inherit;cursor:pointer;">Mark Paid</button>` : '<span style="color:#22c55e;font-size:.8rem;font-weight:700;">Paid ✓</span>'}
      </div>`).join('');
    showToast(`Split: ${guests.filter(g=>!g.paid).length} pending · ${guests.filter(g=>g.paid).length} paid`);
    // Simple alert for now — can be enhanced with a view modal
    console.log('Split plan:', split);
  } catch (err) { showToast(`❌ ${err.message}`); }
}

async function markGuestPaid(orderId, guestIdx) {
  try {
    await apiFetch(`/orders/${orderId}/split/${guestIdx}`, { method: 'PATCH' });
    showToast(`✅ Payment recorded`);
    viewSplitPlan(orderId);
  } catch (err) { showToast(`❌ ${err.message}`); }
}

// Add CSS for split-type-btn dynamically
const splitStyle = document.createElement('style');
splitStyle.textContent = `
  .split-type-btn {
    flex:1;padding:10px;border-radius:10px;border:1px solid var(--border);
    background:var(--bar-bg);color:var(--muted);font-family:inherit;
    font-size:.85rem;font-weight:600;cursor:pointer;transition:all .15s;
  }
  .split-type-btn.active {
    background:rgba(249,115,22,.15);border-color:#f97316;color:#f97316;
  }
`;
document.head.appendChild(splitStyle);

// ── TOAST ──────────────────────────────────────────────────────────────────────
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
    id: wcCallCounter,
    table: data.table,
    reason: data.reason || 'Assistance needed',
    time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
  });
  renderWaiterCalls();
  if (!wcPanelOpen) openWaiterPanel();
}

function toggleWaiterPanel() { wcPanelOpen ? closeWaiterPanel() : openWaiterPanel(); }
function openWaiterPanel()  {
  wcPanelOpen = true;
  document.getElementById('wcPanel').classList.add('open');
  const badge = document.getElementById('wcBadge');
  if (badge) badge.style.display = 'none';
}
function closeWaiterPanel() {
  wcPanelOpen = false;
  document.getElementById('wcPanel').classList.remove('open');
}
function dismissWaiterCall(id) { waiterCalls = waiterCalls.filter(c => c.id !== id); renderWaiterCalls(); }
function dismissAllWaiterCalls() { waiterCalls = []; renderWaiterCalls(); }

function renderWaiterCalls() {
  const list  = document.getElementById('wcList');
  const badge = document.getElementById('wcBadge');
  if (!list) return;

  if (badge) {
    if (waiterCalls.length > 0 && !wcPanelOpen) {
      badge.style.display = 'inline-flex';
      badge.textContent   = waiterCalls.length;
    } else { badge.style.display = 'none'; }
  }

  if (waiterCalls.length === 0) { list.innerHTML = '<p class="wc-empty">✅ No active calls</p>'; return; }

  list.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
      <button onclick="dismissAllWaiterCalls()" style="background:rgba(231,76,60,0.1);border:1px solid rgba(231,76,60,0.3);color:#e74c3c;font-family:inherit;font-size:0.75rem;font-weight:600;padding:5px 12px;border-radius:50px;cursor:pointer;">Clear All</button>
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

// ── AUTO-REFRESH ───────────────────────────────────────────────────────────────
setInterval(() => {
  if (activeTab === 'analytics')    renderAnalytics();
  if (activeTab === 'reservations') loadReservations();
}, 30000);

// ── INIT ──────────────────────────────────────────────────────────────────────
connectWS();
renderOrders();

// Set today as default date filter for reservations
const resDateEl = document.getElementById('resDateFilter');
if (resDateEl) resDateEl.value = new Date().toISOString().split('T')[0];

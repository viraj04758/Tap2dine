// ── API CONFIG ────────────────────────────────────────────────────────────────
const API = 'http://localhost:8000/api';
const WS  = 'ws://localhost:8000/ws';

// ── URL TABLE DETECTION ───────────────────────────────────────────────────────
const params      = new URLSearchParams(window.location.search);
const tableNumber = params.get('table') || '4';
document.getElementById('tableBadge').textContent = `Table ${tableNumber}`;

// ── STATE ─────────────────────────────────────────────────────────────────────
let MENU          = [];
let cart          = {};   // { itemId: qty }
let currentFilter = 'all';
let activeOrderId = null; // track the last placed order for live status
let orderHistory  = [];   // session order history
let waiterCooldown = false;

// ── WEBSOCKET: LIVE STATUS UPDATES ───────────────────────────────────────────
let ws;

function connectWS() {
  try {
    ws = new WebSocket(WS);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.event === 'order_status_changed' && activeOrderId) {
        const order = msg.data;
        if (order.id === activeOrderId) {
          updateStatusBanner(order.status);
        }
        // Always keep orderHistory in sync
        const hist = orderHistory.find(o => o.id === order.id);
        if (hist) hist.status = order.status;
      }

      if (msg.event === 'menu_updated') {
        // Silently reload the menu so the customer always sees fresh items
        loadMenu();
      }
    };

    ws.onclose = () => {
      // Auto-reconnect after 3 s
      setTimeout(connectWS, 3000);
    };

    ws.onerror = () => ws.close();

  } catch (e) {
    // WebSocket not supported or server not running — fail silently
  }
}

function updateStatusBanner(status) {
  const banner = document.getElementById('statusBanner');
  if (!banner) return;

  const icons  = { Pending: '⏳', Preparing: '🔥', Ready: '✅', Delivered: '🤝' };
  const colors = {
    Pending:   '#f59e0b',
    Preparing: '#3b82f6',
    Ready:     '#10b981',
    Delivered: '#6b7280',
  };

  banner.textContent        = `${icons[status] || ''} Your order is: ${status}`;
  banner.style.background   = colors[status] || 'var(--accent)';
  banner.style.display      = 'flex';

  if (status === 'Delivered') {
    setTimeout(() => {
      banner.style.display = 'none';
      activeOrderId = null;
    }, 5000);
  }
}

// ── FETCH MENU FROM API ───────────────────────────────────────────────────────
async function loadMenu() {
  try {
    const res  = await fetch(`${API}/menu`);
    const data = await res.json();
    MENU = data.items;
    renderMenu(getCurrentItems());
    updateRecommendations(); // initial (empty cart)
  } catch (err) {
    console.error('Failed to load menu:', err);
    showToast('⚠️ Cannot reach server. Is the backend running?');
  }
}

// ── POPULAR / TRENDING STRIP ─────────────────────────────────────────────
async function loadPopular() {
  try {
    const data = await fetch(`${API}/popular`).then(r => r.json());
    const sect  = document.getElementById('popularSection');
    const scroll = document.getElementById('popularScroll');
    const badge  = document.getElementById('popularBadge');

    if (!data.items || data.items.length === 0) return;

    badge.textContent = data.source === 'live' ? 'Based on Orders' : 'Curated Picks';
    scroll.innerHTML  = data.items.map(item => `
      <div class="pop-card" onclick="addToCartById(${item.id})">
        <div class="pop-emoji">${item.emoji}</div>
        <div class="pop-name">${item.name}</div>
        <div class="pop-price">₹${item.price}</div>
        ${item.order_count ? `<div class="pop-count">🔥 ${item.order_count} orders</div>` : ''}
      </div>
    `).join('');

    sect.style.display = 'block';
  } catch (_) {
    // Non-critical — fail silently
  }
}

// ── SMART RECOMMENDATIONS ────────────────────────────────────────────────
// Rule table: if cart has these categories, suggest these
const PAIR_RULES = [
  { if: ['starters'],                         suggest: ['mains', 'drinks'] },
  { if: ['mains'],                            suggest: ['desserts', 'drinks'] },
  { if: ['pizza', 'burgers'],                 suggest: ['drinks', 'desserts'] },
  { if: ['desserts'],                         suggest: ['drinks'] },
  { if: ['drinks'],                           suggest: ['starters'] },
  { if: ['starters', 'mains'],               suggest: ['desserts', 'drinks'] },
  { if: ['starters', 'mains', 'desserts'],   suggest: ['drinks'] },
];

function updateRecommendations() {
  const sect   = document.getElementById('recommendSection');
  const scroll = document.getElementById('recommendScroll');
  if (!sect || !MENU.length) return;

  // Identify what categories are currently in cart
  const cartIds   = Object.keys(cart).map(Number);
  const cartCats  = [...new Set(cartIds.map(id => {
    const item = MENU.find(m => m.id === id);
    return item ? item.cat : null;
  }).filter(Boolean))];

  if (cartCats.length === 0) { sect.style.display = 'none'; return; }

  // Find best matching rule
  let suggestCats = [];
  for (const rule of PAIR_RULES) {
    if (rule.if.every(cat => cartCats.includes(cat))) {
      suggestCats = rule.suggest;
      break;
    }
  }
  // Fallback: suggest anything not already in cart
  if (suggestCats.length === 0) {
    suggestCats = ['mains', 'desserts', 'drinks', 'starters', 'pizza', 'burgers']
      .filter(c => !cartCats.includes(c));
  }

  // Find items to recommend that aren't already in cart
  const candidates = MENU.filter(item =>
    suggestCats.includes(item.cat) && !cart[item.id]
  ).slice(0, 6);

  if (candidates.length === 0) { sect.style.display = 'none'; return; }

  scroll.innerHTML = candidates.map(item => `
    <div class="rec-card" onclick="addToCartById(${item.id})">
      <div class="rec-emoji">${item.emoji}</div>
      <div class="rec-name">${item.name}</div>
      <div class="rec-price">₹${item.price}</div>
      <button class="rec-add">+ Add</button>
    </div>
  `).join('');

  sect.style.display = 'block';
}

// Helper: add to cart by ID then update UI
function addToCartById(id) {
  cart[id] = (cart[id] || 0) + 1;
  updateCartUI();
  renderMenu(getCurrentItems());
  updateRecommendations();
  const item = MENU.find(m => m.id === id);
  if (item) showToast(`${item.emoji} ${item.name} added!`);
}

// ── RENDER MENU ───────────────────────────────────────────────────────────────
function renderMenu(items) {
  const grid = document.getElementById('menuGrid');
  grid.innerHTML = '';

  if (items.length === 0) {
    grid.innerHTML = '<p style="color:var(--muted);padding:24px;">No items in this category.</p>';
    return;
  }

  items.forEach((item, i) => {
    const qty  = cart[item.id] || 0;
    const card = document.createElement('div');
    card.className = 'menu-card';
    card.style.animationDelay = `${i * 0.06}s`;
    card.innerHTML = `
      <div class="menu-card-img">
        ${item.veg  ? `<span class="veg-badge">VEG</span>` : ''}
        ${item.spicy ? `<span class="spicy-badge">🌶️</span>` : ''}
        ${item.emoji}
      </div>
      <div class="menu-card-body">
        <div class="menu-card-name">${item.name}</div>
        <div class="menu-card-desc">${item.desc}</div>
        <div class="menu-card-footer">
          <span class="menu-price">₹${item.price}</span>
          ${qty === 0
            ? `<button class="add-btn" onclick="addToCart(${item.id})">+ Add</button>`
            : `<div class="qty-ctrl">
                 <button onclick="changeQty(${item.id},-1)">−</button>
                 <span id="qty-${item.id}">${qty}</span>
                 <button onclick="changeQty(${item.id},1)">+</button>
               </div>`
          }
        </div>
      </div>`;
    grid.appendChild(card);
  });
}

// ── FILTER ────────────────────────────────────────────────────────────────────
function getCurrentItems() {
  return currentFilter === 'all' ? MENU : MENU.filter(i => i.cat === currentFilter);
}

function filterMenu(cat, btn) {
  currentFilter = cat;
  document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderMenu(getCurrentItems());
}

// ── CART LOGIC ────────────────────────────────────────────────────────────────
function addToCart(id) {
  cart[id] = 1;
  updateCartUI();
  renderMenu(getCurrentItems());
  updateRecommendations();
  const item = MENU.find(m => m.id === id);
  showToast(`${item.emoji} ${item.name} added!`);
}

function changeQty(id, delta) {
  cart[id] = (cart[id] || 0) + delta;
  if (cart[id] <= 0) delete cart[id];
  updateCartUI();
  renderMenu(getCurrentItems());
  updateRecommendations();
}

function updateCartUI() {
  const count = Object.values(cart).reduce((s, v) => s + v, 0);
  const el    = document.getElementById('cartCount');
  el.textContent = count;
  el.classList.add('pop');
  setTimeout(() => el.classList.remove('pop'), 200);
  updateMobileCartBar();
}

function updateMobileCartBar() {
  const count  = Object.values(cart).reduce((s, v) => s + v, 0);
  const bar    = document.getElementById('mobileCartBar');
  const cntEl  = document.getElementById('mcbCount');
  const totEl  = document.getElementById('mcbTotal');
  if (!bar) return;

  if (count === 0) {
    bar.style.display = 'none';
    return;
  }

  let subtotal = 0;
  Object.keys(cart).map(Number).forEach(id => {
    const item = MENU.find(m => m.id === id);
    if (item) subtotal += item.price * cart[id];
  });
  const total = subtotal + Math.round(subtotal * 0.05);

  bar.style.display  = 'flex';   // JS always controls this
  cntEl.textContent  = count;
  totEl.textContent  = `\u20b9${total}`;
  cntEl.classList.add('pop');
  setTimeout(() => cntEl.classList.remove('pop'), 200);
}

// ── CART DRAWER ───────────────────────────────────────────────────────────────
function openCart()  {
  document.getElementById('cartDrawer').classList.add('open');
  document.getElementById('cartOverlay').classList.add('open');
  renderCartDrawer();
}

function closeCart() {
  document.getElementById('cartDrawer').classList.remove('open');
  document.getElementById('cartOverlay').classList.remove('open');
}

function renderCartDrawer() {
  const container = document.getElementById('cartItems');
  const footer    = document.getElementById('cartFooter');
  const empty     = document.getElementById('cartEmpty');
  const keys      = Object.keys(cart).map(Number);

  if (keys.length === 0) {
    empty.style.display = 'flex';
    footer.style.display = 'none';
    container.innerHTML  = '';
    container.appendChild(empty);
    return;
  }

  empty.style.display  = 'none';
  footer.style.display = 'block';
  container.innerHTML  = '';

  let subtotal = 0;
  keys.forEach(id => {
    const item = MENU.find(m => m.id === id);
    const qty  = cart[id];
    subtotal  += item.price * qty;

    const row  = document.createElement('div');
    row.className = 'cart-item';
    row.innerHTML = `
      <div class="cart-item-emoji">${item.emoji}</div>
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-price">₹${item.price} × ${qty} = ₹${item.price * qty}</div>
      </div>
      <div class="cart-item-qty">
        <button onclick="cartQty(${id},-1)">−</button>
        <span>${qty}</span>
        <button onclick="cartQty(${id},1)">+</button>
      </div>`;
    container.appendChild(row);
  });

  const tax   = Math.round(subtotal * 0.05);
  const total = subtotal + tax;
  document.getElementById('cartSubtotal').textContent = `₹${subtotal}`;
  document.getElementById('cartTax').textContent      = `₹${tax}`;
  document.getElementById('cartTotal').textContent    = `₹${total}`;
}

function cartQty(id, delta) {
  cart[id] = (cart[id] || 0) + delta;
  if (cart[id] <= 0) delete cart[id];
  updateCartUI();
  renderCartDrawer();
  renderMenu(getCurrentItems());
}

// ── PLACE ORDER → POST /api/orders ───────────────────────────────────────────
async function placeOrder() {
  const keys = Object.keys(cart).map(Number);
  if (keys.length === 0) return;

  const note  = document.getElementById('orderNote').value.trim();
  const items = keys.map(id => {
    const item = MENU.find(m => m.id === id);
    return { id, name: item.name, emoji: item.emoji, price: item.price, qty: cart[id] };
  });

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const tax      = Math.round(subtotal * 0.05);
  const total    = subtotal + tax;

  const payload  = { table: tableNumber, items, subtotal, tax, total, note };

  try {
    const btn = document.querySelector('.place-order-btn');
    btn.textContent = 'Sending... ⏳';
    btn.disabled    = true;

    const res  = await fetch(`${API}/orders`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();

    // Track this order for live status updates
    activeOrderId = data.order.id;

    // Save to session history
    orderHistory.push({ ...data.order, time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) });
    const hBtn = document.getElementById('historyBtn');
    if (hBtn) { hBtn.style.display = 'flex'; hBtn.textContent = `📋 My Orders (${orderHistory.length})`; }

    document.getElementById('orderId').textContent = `#${data.order.id}`;
    document.getElementById('successModal').style.display = 'flex';
    closeCart();

    // Show live status banner
    updateStatusBanner('Pending');

    cart = {};
    updateCartUI();
    updateMobileCartBar();
    renderMenu(getCurrentItems());

    btn.textContent = 'Place Order 🚀';
    btn.disabled    = false;

  } catch (err) {
    console.error(err);
    showToast('❌ Failed to place order. Is the server running?');
    document.querySelector('.place-order-btn').textContent = 'Place Order 🚀';
    document.querySelector('.place-order-btn').disabled    = false;
  }
}

// ── WAITER CALL ───────────────────────────────────────────────────────────────
async function callWaiter(reason = '') {
  try {
    const res = await fetch(`${API}/waiter-call`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ table: tableNumber, reason }),
    });
    if (!res.ok) throw new Error();
    showToast('🔔 Waiter has been notified!');
  } catch {
    showToast('⚠️ Could not reach waiter. Please wave!');
  }
}

// ── WAITER MODAL ──────────────────────────────────────────────────────────────
let _waiterReason = '';

function openWaiterModal() {
  if (waiterCooldown) { showToast('⏳ Please wait before calling again.'); return; }
  _waiterReason = '';
  document.querySelectorAll('.reason-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('waiterConfirmBtn').disabled = true;
  document.getElementById('waiterConfirmBtn').textContent = '🔔 Notify Waiter';
  document.getElementById('waiterModalOverlay').style.display = 'flex';
}

function closeWaiterModal() {
  document.getElementById('waiterModalOverlay').style.display = 'none';
}

function closeWaiterModalOutside(e) {
  if (e.target === e.currentTarget) closeWaiterModal();
}

function selectWaiterReason(btn) {
  document.querySelectorAll('.reason-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _waiterReason = btn.dataset.reason;
  document.getElementById('waiterConfirmBtn').disabled = false;
}

async function confirmWaiterCall() {
  const btn = document.getElementById('waiterConfirmBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Notifying...';
  await callWaiter(_waiterReason);
  closeWaiterModal();

  // Disable main waiter button for 15s
  waiterCooldown = true;
  const fab = document.getElementById('waiterBtn');
  if (fab) { fab.disabled = true; fab.textContent = '⏳ Notified…'; }
  setTimeout(() => {
    waiterCooldown = false;
    if (fab) { fab.disabled = false; fab.textContent = '🔔 Call Waiter'; }
  }, 15000);
}

// ── ORDER HISTORY ─────────────────────────────────────────────────────────────
function openOrderHistory() {
  renderOrderHistory();
  document.getElementById('orderHistoryOverlay').style.display = 'flex';
}

function closeOrderHistory() {
  document.getElementById('orderHistoryOverlay').style.display = 'none';
}

function closeHistoryOutside(e) {
  if (e.target === e.currentTarget) closeOrderHistory();
}

function renderOrderHistory() {
  const list = document.getElementById('orderHistoryList');
  if (!list) return;
  if (orderHistory.length === 0) {
    list.innerHTML = '<p style="text-align:center;color:var(--muted);padding:20px 0;">No orders yet this session.</p>';
    return;
  }
  list.innerHTML = orderHistory.slice().reverse().map(order => `
    <div style="background:var(--card2);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-weight:800;color:var(--accent2);">#${order.id}</span>
        <span style="font-size:0.75rem;color:var(--muted);">${order.time}</span>
      </div>
      ${order.items.map(i => `
        <div style="font-size:0.85rem;padding:4px 0;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;">
          <span>${i.emoji}</span>
          <span style="flex:1;">${i.name}</span>
          <span style="color:var(--muted);">×${i.qty}</span>
          <span style="color:var(--accent2);font-weight:700;">₹${i.price * i.qty}</span>
        </div>`).join('')}
      <div style="display:flex;justify-content:space-between;margin-top:8px;font-weight:700;">
        <span style="color:var(--muted);font-size:0.85rem;">Total</span>
        <span style="color:var(--accent2);">₹${order.total}</span>
      </div>
      <div style="margin-top:6px;">
        <span style="font-size:0.72rem;font-weight:700;padding:3px 10px;border-radius:50px;
          background:${order.status==='Delivered'?'rgba(46,204,113,0.15)':order.status==='Ready'?'rgba(52,152,219,0.15)':'rgba(255,107,53,0.15)'};
          color:${order.status==='Delivered'?'#2ecc71':order.status==='Ready'?'#3498db':'#ff6b35'};
          border:1px solid ${order.status==='Delivered'?'#2ecc71':order.status==='Ready'?'#3498db':'#ff6b35'};
        ">${order.status}</span>
      </div>
    </div>`).join('');
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
function closeModal() {
  document.getElementById('successModal').style.display = 'none';
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ── INIT ──────────────────────────────────────────────────────────────────
connectWS();
loadMenu();
loadPopular();

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/static/sw.js')
      .then(() => console.log('📱 SW registered'))
      .catch(() => {});
  });
}

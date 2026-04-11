// ── API CONFIG ────────────────────────────────────────────────────────────────
const API = 'http://localhost:8000/api';
const WS  = 'ws://localhost:8000/ws';

// ── URL TABLE DETECTION ───────────────────────────────────────────────────────
const params       = new URLSearchParams(window.location.search);
const tableNumber  = params.get('table') || '4';
const restaurantId = params.get('restaurant_id') || 'tap2dine';
document.getElementById('tableBadge').textContent = `Table ${tableNumber}`;

// ── STATE ─────────────────────────────────────────────────────────────────────
let MENU          = [];
let cart          = {};   // { itemId: qty }
let currentFilter = 'all';
let activeOrderId = null;
let lastPlacedOrder = null;  // for bill split
let orderHistory  = [];
let waiterCooldown = false;
let aiRecommendTimer = null;

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
    const res  = await fetch(`${API}/menu?restaurant_id=${restaurantId}`);
    const data = await res.json();
    MENU = data.items;
    renderMenu(getCurrentItems());
    scheduleAiRecommendations();
  } catch (err) {
    console.error('Failed to load menu:', err);
    showToast('⚠️ Cannot reach server. Is the backend running?');
  }
}

// ── POPULAR / TRENDING STRIP ─────────────────────────────────────────────
async function loadPopular() {
  try {
    const data  = await fetch(`${API}/popular?restaurant_id=${restaurantId}`).then(r => r.json());
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
  } catch (_) {}
}

// ── AI RECOMMENDATIONS (Gemini Flash via backend) ────────────────────────────
function scheduleAiRecommendations() {
  clearTimeout(aiRecommendTimer);
  aiRecommendTimer = setTimeout(fetchAiRecommendations, 700);
}

async function fetchAiRecommendations() {
  const sect   = document.getElementById('recommendSection');
  const scroll = document.getElementById('recommendScroll');
  if (!sect || !MENU.length) return;

  const cartIds = Object.keys(cart).map(Number);
  if (cartIds.length === 0) { sect.style.display = 'none'; return; }

  sect.style.display = 'block';
  scroll.innerHTML = `<div style="display:flex;gap:8px;">${[1,2,3].map(() =>
    `<div style="width:140px;height:90px;background:var(--card2);border-radius:14px;opacity:.5;animation:aiPulse 1.2s infinite;"></div>`
  ).join('')}</div>`;

  try {
    const cartItems = cartIds.map(id => {
      const item = MENU.find(m => m.id === id);
      return { id, name: item.name, emoji: item.emoji, price: item.price, qty: cart[id], cat: item.cat };
    });
    const res  = await fetch(`${API}/recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cart: cartItems, restaurant_id: restaurantId }),
    });
    const data = await res.json();
    const recs = data.recommendations;
    if (!recs || recs.length === 0) { sect.style.display = 'none'; return; }

    const titleEl = sect.querySelector('.strip-title');
    if (titleEl) titleEl.innerHTML = '🤖 AI Picks For You <span style="font-size:.65rem;background:rgba(99,102,241,.15);color:#818cf8;padding:2px 8px;border-radius:50px;margin-left:6px;font-weight:700;">Gemini</span>';

    scroll.innerHTML = recs.map(item => `
      <div class="rec-card" onclick="addToCartById(${item.id})">
        <div class="rec-emoji">${item.emoji}</div>
        <div class="rec-name">${item.name}</div>
        <div style="font-size:.7rem;color:var(--muted);margin-bottom:4px;line-height:1.3;">${item.reason}</div>
        <div class="rec-price">₹${item.price}</div>
        <button class="rec-add">+ Add</button>
      </div>`).join('');
    sect.style.display = 'block';
  } catch { sect.style.display = 'none'; }
}

const _recStyle = document.createElement('style');
_recStyle.textContent = `@keyframes aiPulse { 0%,100%{opacity:.5} 50%{opacity:.85} }`;
document.head.appendChild(_recStyle);

function updateRecommendations() { scheduleAiRecommendations(); }

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

// ── PAYMENT MODAL ─────────────────────────────────────────────────────────────
function openPaymentModal() {
  const keys = Object.keys(cart).map(Number);
  if (keys.length === 0) return;

  // Compute total to display in the modal
  const subtotal = keys.reduce((s, id) => {
    const item = MENU.find(m => m.id === Number(id));
    return s + (item ? item.price * cart[id] : 0);
  }, 0);
  const tax   = Math.round(subtotal * 0.05);
  const total = subtotal + tax;

  document.getElementById('paymentModalTotal').textContent = `Total: ₹${total}`;
  document.getElementById('paymentModal').style.display    = 'flex';
}

function closePaymentModal() {
  document.getElementById('paymentModal').style.display = 'none';
}

function closePaymentModalOutside(e) {
  if (e.target.id === 'paymentModal') closePaymentModal();
}

// ── PAY ONLINE (RAZORPAY) ─────────────────────────────────────────────────────
async function payOnline() {
  const btn = document.getElementById('payOnlineBtn');
  btn.disabled    = true;
  btn.textContent = '⏳ Creating order…';

  const keys = Object.keys(cart).map(Number);
  const note = document.getElementById('orderNote').value.trim();
  const items = keys.map(id => {
    const item = MENU.find(m => m.id === id);
    return { id, name: item.name, emoji: item.emoji, price: item.price, qty: cart[id] };
  });
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const tax      = Math.round(subtotal * 0.05);
  const total    = subtotal + tax;

  try {
    // 1️⃣ Create Razorpay order on backend
    const res = await fetch(`${API}/payment/create-order`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ amount: total }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Could not create payment order');
    }

    const rzpOrder = await res.json();

    btn.disabled    = false;
    btn.textContent = '📱 Pay Online';
    closePaymentModal();

    // 2️⃣ Open Razorpay checkout widget
    const options = {
      key:         rzpOrder.key_id,
      amount:      rzpOrder.amount,
      currency:    rzpOrder.currency,
      name:        'Tap2Dine',
      description: `Table ${tableNumber} — ${items.length} item(s)`,
      order_id:    rzpOrder.order_id,
      theme:       { color: '#ff6b35' },

      prefill: {
        name:    '',
        email:   '',
        contact: '',
      },

      // 3️⃣ On payment success → verify on backend → place order
      handler: async function (response) {
        try {
          showToast('🔐 Verifying payment…');

          const verifyRes = await fetch(`${API}/payment/verify`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              razorpay_order_id:   response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature:  response.razorpay_signature,
            }),
          });

          if (!verifyRes.ok) throw new Error('Signature verification failed');

          // 4️⃣ Place the order (with payment proof)
          await submitOrder({
            items, subtotal, tax, total, note,
            payment_method:      'online',
            razorpay_order_id:   response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature:  response.razorpay_signature,
          });

        } catch (err) {
          showToast('❌ Payment verification failed. Contact staff.');
          console.error(err);
        }
      },

      modal: {
        ondismiss: () => showToast('⚡ Payment cancelled'),
      },
    };

    const rzp = new Razorpay(options);
    rzp.on('payment.failed', () => {
      showToast('❌ Payment failed. Please try again.');
    });
    rzp.open();

  } catch (err) {
    btn.disabled    = false;
    btn.textContent = '📱 Pay Online';
    showToast(`⚠️ ${err.message}`);
    console.error(err);
  }
}

// ── PAY AT HOTEL (CASH) ───────────────────────────────────────────────────────
async function payAtHotel() {
  closePaymentModal();

  const keys = Object.keys(cart).map(Number);
  const note = document.getElementById('orderNote').value.trim();
  const items = keys.map(id => {
    const item = MENU.find(m => m.id === id);
    return { id, name: item.name, emoji: item.emoji, price: item.price, qty: cart[id] };
  });
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const tax      = Math.round(subtotal * 0.05);
  const total    = subtotal + tax;

  await submitOrder({ items, subtotal, tax, total, note, payment_method: 'cash' });
}

// ── SUBMIT ORDER → POST /api/orders ──────────────────────────────────────────
async function submitOrder(paymentData) {
  const placeBtn = document.querySelector('.place-order-btn');
  if (placeBtn) { placeBtn.textContent = 'Sending… ⏳'; placeBtn.disabled = true; }

  const payload = {
    table: tableNumber,
    ...paymentData,
  };

  try {
    const res  = await fetch(`${API}/orders`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();

    activeOrderId   = data.order.id;
    lastPlacedOrder = data.order;

    orderHistory.push({
      ...data.order,
      payment_method: paymentData.payment_method || 'cash',
      time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    });

    const hBtn = document.getElementById('historyBtn');
    if (hBtn) {
      hBtn.style.display = 'flex';
      hBtn.textContent   = `📋 My Orders (${orderHistory.length})`;
    }

    // Show success modal
    const method = paymentData.payment_method === 'online' ? '💳 Paid Online' : '💵 Pay at Hotel';
    document.getElementById('orderId').textContent = `#${data.order.id}`;

    // Payment badge
    let badge = document.getElementById('paymentBadge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'paymentBadge';
      badge.style.cssText = `display:inline-block;margin-top:10px;padding:6px 18px;border-radius:50px;font-size:0.8rem;font-weight:700;letter-spacing:0.05em;background:${paymentData.payment_method==='online'?'rgba(102,126,234,0.15);color:#764ba2;border:1px solid #764ba2':'rgba(17,153,142,0.15);color:#11998e;border:1px solid #11998e'};`;
      document.querySelector('.modal-card').appendChild(badge);
    }
    badge.textContent = method;

    // Split Bill button
    if (!document.getElementById('splitBillBtn')) {
      const splitBtn = document.createElement('button');
      splitBtn.id = 'splitBillBtn';
      splitBtn.textContent = '💸 Split the Bill';
      splitBtn.style.cssText = `display:block;width:100%;margin-top:14px;padding:12px;background:rgba(249,115,22,.12);color:#f97316;border:1px solid rgba(249,115,22,.4);border-radius:12px;font-size:.9rem;font-weight:700;font-family:inherit;cursor:pointer;transition:background .2s;`;
      splitBtn.onclick = openBillSplitModal;
      document.querySelector('.modal-card').appendChild(splitBtn);
    }

    document.getElementById('successModal').style.display = 'flex';

    closeCart();
    updateStatusBanner('Pending');

    cart = {};
    updateCartUI();
    updateMobileCartBar();
    renderMenu(getCurrentItems());

  } catch (err) {
    console.error(err);
    showToast('❌ Failed to place order. Is the server running?');
  } finally {
    if (placeBtn) { placeBtn.textContent = 'Place Order 🚀'; placeBtn.disabled = false; }
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

// ── BILL SPLIT (CUSTOMER) ─────────────────────────────────────────────────────
let _cSplitGuests = 2;
let _cSplitType   = 'equal';

function openBillSplitModal() {
  if (!lastPlacedOrder) return;
  _cSplitGuests = 2;
  _cSplitType   = 'equal';

  // Build modal HTML and inject into body
  let m = document.getElementById('customerSplitModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'customerSplitModal';
    m.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1200;align-items:center;justify-content:center;';
    m.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:20px;padding:28px;width:min(440px,94vw);max-height:85vh;overflow-y:auto;">
        <h3 style="margin-bottom:4px;">💸 Split the Bill</h3>
        <p id="cSplitLabel" style="color:var(--muted);font-size:.85rem;margin-bottom:18px;"></p>

        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <button class="c-split-type active" id="cBtnEqual" onclick="setCsplit('equal',this)">⚖️ Equal</button>
          <button class="c-split-type" id="cBtnCustom" onclick="setCsplit('custom',this)">✏️ Custom</button>
        </div>

        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
          <span style="font-size:.8rem;color:var(--muted);font-weight:600;">GUESTS</span>
          <button onclick="cSplitDelta(-1)" style="width:32px;height:32px;border-radius:8px;border:1px solid var(--border);background:var(--card2);color:var(--text);font-size:1rem;cursor:pointer;">−</button>
          <span id="cSplitCount" style="font-weight:700;font-size:1.1rem;min-width:20px;text-align:center;">2</span>
          <button onclick="cSplitDelta(1)"  style="width:32px;height:32px;border-radius:8px;border:1px solid var(--border);background:var(--card2);color:var(--text);font-size:1rem;cursor:pointer;">+</button>
        </div>
        <div id="cSplitRows" style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px;"></div>
        <button onclick="submitCustomerSplit()" style="width:100%;padding:14px;background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;border:none;border-radius:12px;font-size:.95rem;font-weight:700;font-family:inherit;cursor:pointer;">✅ Confirm Split</button>
        <button onclick="document.getElementById('customerSplitModal').style.display='none'" style="width:100%;margin-top:8px;padding:12px;background:transparent;color:var(--muted);border:1px solid var(--border);border-radius:12px;font-size:.85rem;font-family:inherit;cursor:pointer;">Cancel</button>
      </div>`;
    const st = document.createElement('style');
    st.textContent = `.c-split-type{flex:1;padding:9px;border-radius:10px;border:1px solid var(--border);background:var(--card2);color:var(--muted);font-family:inherit;font-size:.82rem;font-weight:600;cursor:pointer;transition:all .15s;}.c-split-type.active{background:rgba(249,115,22,.15);border-color:#f97316;color:#f97316;}`;
    document.head.appendChild(st);
    document.body.appendChild(m);
  }

  document.getElementById('cSplitLabel').textContent = `Order #${lastPlacedOrder.id} · Total ₹${lastPlacedOrder.total}`;
  document.getElementById('cSplitCount').textContent = _cSplitGuests;
  renderCsplitRows();
  m.style.display = 'flex';
}

function setCsplit(type, btn) {
  _cSplitType = type;
  document.querySelectorAll('.c-split-type').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderCsplitRows();
}

function cSplitDelta(d) {
  _cSplitGuests = Math.max(2, Math.min(10, _cSplitGuests + d));
  document.getElementById('cSplitCount').textContent = _cSplitGuests;
  renderCsplitRows();
}

function renderCsplitRows() {
  const rows = document.getElementById('cSplitRows');
  const perHead = Math.ceil(lastPlacedOrder.total / _cSplitGuests);
  let html = '';
  for (let i = 0; i < _cSplitGuests; i++) {
    const amt = _cSplitType === 'equal' ? perHead : 0;
    html += `
      <div style="display:flex;align-items:center;gap:8px;background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;">
        <span>👤</span>
        <input id="cs-name-${i}" placeholder="Guest ${i+1}" style="flex:1;background:transparent;border:none;color:var(--text);font-family:inherit;font-size:.9rem;outline:none;" />
        <span style="color:var(--muted);">₹</span>
        <input type="number" id="cs-amt-${i}" value="${amt}" min="0" style="width:68px;background:transparent;border:none;color:var(--accent);font-family:inherit;font-size:.9rem;font-weight:700;text-align:right;outline:none;" ${_cSplitType==='equal'?'readonly':''} />
      </div>`;
  }
  rows.innerHTML = html;
}

async function submitCustomerSplit() {
  const guests = [];
  for (let i = 0; i < _cSplitGuests; i++) {
    guests.push({
      name:   document.getElementById(`cs-name-${i}`)?.value.trim() || `Guest ${i+1}`,
      amount: parseInt(document.getElementById(`cs-amt-${i}`)?.value) || 0,
      paid:   false,
    });
  }

  try {
    const res = await fetch(`${API}/orders/${lastPlacedOrder.id}/split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: lastPlacedOrder.id, guests, split_type: _cSplitType }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || 'Split failed');
    document.getElementById('customerSplitModal').style.display = 'none';

    // Show a summary
    const perHead = guests[0]?.amount || Math.ceil(lastPlacedOrder.total / _cSplitGuests);
    showToast(`✅ Split created! ${_cSplitGuests} guests · ₹${perHead} each`);
  } catch (err) { showToast(`❌ ${err.message}`); }
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

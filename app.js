// ── TAP2DINE CUSTOMER APP ─────────────────────────────────────────────────────
const API = 'http://localhost:8000/api';
const WS  = 'ws://localhost:8000/ws';

// ── STATE ────────────────────────────────────────────────────────────────────
let restaurantId = 'tap2dine';
let tableNo      = '1';
let cart         = [];
let menu         = [];
let orders       = [];
let wsConnected  = false;
let currentFilter = 'all';
let ws           = null;

// ── URL PARAMS ────────────────────────────────────────────────────────────────
function initFromURL() {
  const params = new URLSearchParams(window.location.search);
  tableNo = params.get('table') || '1';
  restaurantId = params.get('restaurant') || 'tap2dine';
  document.getElementById('tableBadge').textContent = `Table ${tableNo}`;
  document.title = `Table ${tableNo} — Tap2Dine`;
}

// ── MENU LOADING ──────────────────────────────────────────────────────────────
async function loadMenu() {
  try {
    const res = await fetch(`${API}/menu`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    menu = data.items || [];
    renderMenu('all');
    loadPopularAndRecommend();
  } catch (err) {
    console.error('Menu load error:', err);
    showToast('❌ Failed to load menu. Please refresh.');
  }
}

// ── RENDER MENU ───────────────────────────────────────────────────────────────
function renderMenu(category = 'all') {
  const grid = document.getElementById('menuGrid');
  grid.innerHTML = '';
  
  const filtered = category === 'all' ? menu : menu.filter(m => m.cat === category);
  
  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:var(--muted);">
        <p style="font-size:1rem;margin-bottom:8px;">🔍 No items in this category</p>
        <small>Check back soon for updates</small>
      </div>
    `;
    return;
  }
  
  filtered.forEach(item => {
    const cardHTML = `
      <div class="menu-card" role="article" aria-label="Menu item: ${item.name}">
        <div class="menu-card-img" role="img" aria-label="${item.emoji}">${item.emoji}</div>
        ${item.veg ? `<div class="veg-badge">● VEG</div>` : ''}
        ${item.spicy ? `<div class="spicy-badge">🌶️</div>` : ''}
        <div class="menu-card-body">
          <h3 class="menu-card-name">${item.name}</h3>
          <p class="menu-card-desc">${item.desc}</p>
          <div class="menu-card-footer">
            <span class="menu-price">₹${item.price}</span>
            <div id="qty-${item.id}" style="display:none;" class="qty-ctrl">
              <button aria-label="Decrease quantity" onclick="updateQty(${item.id}, -1)">−</button>
              <span id="qty-val-${item.id}">0</span>
              <button aria-label="Increase quantity" onclick="updateQty(${item.id}, 1)">+</button>
            </div>
            <button class="add-btn" id="add-${item.id}" onclick="addToCart(${item.id}, '${item.name}', ${item.price}, '${item.emoji}')"
              aria-label="Add ${item.name} to cart">+ Add</button>
          </div>
        </div>
      </div>
    `;
    grid.insertAdjacentHTML('beforeend', cardHTML);
  });
}

// ── FILTER MENU ───────────────────────────────────────────────────────────────
function filterMenu(category, btn) {
  currentFilter = category;
  document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderMenu(category);
}

// ── ADD TO CART ───────────────────────────────────────────────────────────────
function addToCart(itemId, name, price, emoji) {
  const existing = cart.find(c => c.id === itemId);
  
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ id: itemId, name, price, emoji, qty: 1 });
  }
  
  updateQtyDisplay(itemId);
  updateCartUI();
  showToast(`✅ Added ${name} to cart`);
}

// ── UPDATE QTY ────────────────────────────────────────────────────────────────
function updateQty(itemId, delta) {
  const item = cart.find(c => c.id === itemId);
  if (!item) return;
  
  item.qty += delta;
  if (item.qty <= 0) {
    cart = cart.filter(c => c.id !== itemId);
  }
  
  updateQtyDisplay(itemId);
  updateCartUI();
}

function updateQtyDisplay(itemId) {
  const item = cart.find(c => c.id === itemId);
  const qtyCtrl = document.getElementById(`qty-${itemId}`);
  const addBtn = document.getElementById(`add-${itemId}`);
  
  if (!qtyCtrl || !addBtn) return;
  
  if (item && item.qty > 0) {
    qtyCtrl.style.display = 'flex';
    addBtn.style.display = 'none';
    document.getElementById(`qty-val-${itemId}`).textContent = item.qty;
  } else {
    qtyCtrl.style.display = 'none';
    addBtn.style.display = 'flex';
  }
}

// ── UPDATE CART UI ────────────────────────────────────────────────────────────
function updateCartUI() {
  const count = cart.reduce((sum, c) => sum + c.qty, 0);
  const subtotal = cart.reduce((sum, c) => sum + c.price * c.qty, 0);
  const tax = Math.ceil(subtotal * 0.05);
  const total = subtotal + tax;
  
  // Update header
  document.getElementById('cartCount').textContent = count;
  if (count > 0) document.getElementById('cartCount').classList.add('pop');
  
  // Update drawer
  const itemsContainer = document.getElementById('cartItems');
  const footer = document.getElementById('cartFooter');
  const empty = document.getElementById('cartEmpty');
  
  if (cart.length === 0) {
    empty.style.display = 'flex';
    footer.style.display = 'none';
    itemsContainer.innerHTML = `<div class="cart-empty"><span>🛒</span><p>Your cart is empty</p><small>Add items from the menu to get started</small></div>`;
  } else {
    empty.style.display = 'none';
    footer.style.display = 'block';
    itemsContainer.innerHTML = cart.map(c => `
      <div class="cart-item">
        <div class="cart-item-emoji">${c.emoji}</div>
        <div class="cart-item-info">
          <div class="cart-item-name">${c.name}</div>
          <div class="cart-item-price">₹${c.price}/ea</div>
        </div>
        <div class="cart-item-qty">
          <button onclick="updateQty(${c.id}, -1)" aria-label="Decrease ${c.name}">−</button>
          <span>${c.qty}</span>
          <button onclick="updateQty(${c.id}, 1)" aria-label="Increase ${c.name}">+</button>
        </div>
      </div>
    `).join('');
  }
  
  document.getElementById('cartSubtotal').textContent = `₹${subtotal}`;
  document.getElementById('cartTax').textContent = `₹${tax}`;
  document.getElementById('cartTotal').textContent = `₹${total}`;
  
  // Mobile sticky bar
  const mobileBar = document.getElementById('mobileCartBar');
  if (count > 0) {
    mobileBar.style.display = 'flex';
    document.getElementById('mcbCount').textContent = count;
    document.getElementById('mcbTotal').textContent = `₹${total}`;
  } else {
    mobileBar.style.display = 'none';
  }
}

// ── CART ACTIONS ──────────────────────────────────────────────────────────────
function openCart() {
  document.getElementById('cartOverlay').classList.add('open');
  document.getElementById('cartDrawer').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCart() {
  document.getElementById('cartOverlay').classList.remove('open');
  document.getElementById('cartDrawer').classList.remove('open');
  document.body.style.overflow = 'auto';
}

function openPaymentModal() {
  if (cart.length === 0) {
    showToast('⚠️ Add items to your cart first');
    return;
  }
  const total = cart.reduce((sum, c) => sum + c.price * c.qty, 0) + Math.ceil(cart.reduce((sum, c) => sum + c.price * c.qty, 0) * 0.05);
  document.getElementById('paymentModalTotal').textContent = `Total: ₹${total}`;
  document.getElementById('paymentModal').style.display = 'flex';
}

function closePaymentModal() {
  document.getElementById('paymentModal').style.display = 'none';
}

function closePaymentModalOutside(e) {
  if (e.target.id === 'paymentModal') closePaymentModal();
}

// ── PAYMENT: ONLINE (RAZORPAY) ────────────────────────────────────────────────
function payOnline() {
  const note = document.getElementById('orderNote')?.value.trim() || '';
  const total = cart.reduce((sum, c) => sum + c.price * c.qty, 0) + Math.ceil(cart.reduce((sum, c) => sum + c.price * c.qty, 0) * 0.05);
  
  const options = {
    key: 'rzp_test_key_here', // Replace with your Razorpay key
    amount: total * 100, // Razorpay expects amount in paise
    currency: 'INR',
    name: 'Tap2Dine',
    description: `Order for Table ${tableNo}`,
    prefill: { contact: '', email: '' },
    handler: async (response) => {
      await placeOrder('online', note, response.razorpay_payment_id);
    },
    modal: { ondismiss: () => showToast('❌ Payment cancelled') },
  };
  
  new Razorpay(options).open();
}

// ── PAYMENT: CASH ─────────────────────────────────────────────────────────────
function payAtHotel() {
  const note = document.getElementById('orderNote')?.value.trim() || '';
  placeOrder('cash', note);
}

// ── PLACE ORDER ───────────────────────────────────────────────────────────────
async function placeOrder(paymentMethod, note = '', transactionId = null) {
  if (cart.length === 0) return;
  
  const subtotal = cart.reduce((sum, c) => sum + c.price * c.qty, 0);
  const tax = Math.ceil(subtotal * 0.05);
  const total = subtotal + tax;
  
  const payload = {
    restaurant_id: restaurantId,
    table: tableNo,
    items: cart.map(c => ({
      id: c.id,
      name: c.name,
      emoji: c.emoji,
      price: c.price,
      qty: c.qty,
    })),
    subtotal,
    tax,
    total,
    note,
    payment_method: paymentMethod,
    transaction_id: transactionId,
  };
  
  try {
    const res = await fetch(`${API}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    // Add to order history
    orders.push({ ...payload, id: data.order.id, status: 'Pending', time: new Date().toLocaleTimeString() });
    
    // Show success modal
    document.getElementById('orderId').textContent = `#T2D-${String(data.order.id).padStart(4, '0')}`;
    document.getElementById('successModal').style.display = 'flex';
    
    // Clear cart
    cart = [];
    updateCartUI();
    closeCart();
    closePaymentModal();
    
    // Show order history button
    document.getElementById('historyBtn').style.display = 'flex';
  } catch (err) {
    console.error('Order error:', err);
    showToast(`❌ ${err.message}`);
  }
}

function closeModal() {
  document.getElementById('successModal').style.display = 'none';
}

// ── WAITER CALL ───────────────────────────────────────────────────────────────
let selectedWaiterReason = null;

function openWaiterModal() {
  selectedWaiterReason = null;
  document.getElementById('waiterModalOverlay').style.display = 'flex';
  document.querySelectorAll('.reason-btn').forEach(b => b.classList.remove('active'));
}

function closeWaiterModal() {
  document.getElementById('waiterModalOverlay').style.display = 'none';
}

function closeWaiterModalOutside(e) {
  if (e.target.id === 'waiterModalOverlay') closeWaiterModal();
}

function selectWaiterReason(btn) {
  document.querySelectorAll('.reason-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedWaiterReason = btn.dataset.reason;
  document.getElementById('waiterConfirmBtn').disabled = false;
}

async function confirmWaiterCall() {
  if (!selectedWaiterReason) return;
  
  try {
    await fetch(`${API}/waiter-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        restaurant_id: restaurantId,
        table: tableNo,
        reason: selectedWaiterReason,
      }),
    });
    
    showToast('🔔 Waiter notified!');
    closeWaiterModal();
  } catch (err) {
    console.error('Waiter call error:', err);
    showToast('❌ Failed to call waiter');
  }
}

// ── ORDER HISTORY ─────────────────────────────────────────────────────────────
function openOrderHistory() {
  const list = document.getElementById('orderHistoryList');
  if (orders.length === 0) {
    list.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">No orders yet this session</p>';
  } else {
    list.innerHTML = orders.map((o, i) => `
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-weight:700;">#T2D-${String(o.id).padStart(4, '0')}</span>
          <span style="font-size:0.8rem;color:var(--accent);font-weight:700;">${o.status}</span>
        </div>
        <div style="font-size:0.85rem;color:var(--muted);margin-bottom:6px;">${o.time}</div>
        <div style="font-size:0.9rem;font-weight:600;color:var(--accent2);">₹${o.total}</div>
      </div>
    `).join('');
  }
  document.getElementById('orderHistoryOverlay').style.display = 'flex';
}

function closeOrderHistory() {
  document.getElementById('orderHistoryOverlay').style.display = 'none';
}

function closeHistoryOutside(e) {
  if (e.target.id === 'orderHistoryOverlay') closeOrderHistory();
}

// ── POPULAR & RECOMMENDATIONS ─────────────────────────────────────────────────
function loadPopularAndRecommend() {
  if (menu.length < 3) return;
  
  // Simulate "popular" by taking random items
  const popular = menu.sort(() => Math.random() - 0.5).slice(0, 5);
  const recommend = menu.filter(m => m.cat === 'drinks' || m.cat === 'desserts').slice(0, 4);
  
  if (popular.length > 0) {
    document.getElementById('popularSection').style.display = 'block';
    document.getElementById('popularScroll').innerHTML = popular.map(m => `
      <div class="pop-card" onclick="addToCart(${m.id}, '${m.name}', ${m.price}, '${m.emoji}')" role="button" tabindex="0" 
        aria-label="Add ${m.name} to cart">
        <div class="pop-emoji">${m.emoji}</div>
        <div class="pop-name">${m.name}</div>
        <div class="pop-price">₹${m.price}</div>
        <div class="pop-count">Popular</div>
      </div>
    `).join('');
  }
  
  if (recommend.length > 0) {
    document.getElementById('recommendSection').style.display = 'block';
    document.getElementById('recommendScroll').innerHTML = recommend.map(m => `
      <div class="rec-card" role="button" tabindex="0" aria-label="${m.name}">
        <div class="rec-emoji">${m.emoji}</div>
        <div class="rec-name">${m.name}</div>
        <div class="rec-price">₹${m.price}</div>
        <button class="rec-add" onclick="addToCart(${m.id}, '${m.name}', ${m.price}, '${m.emoji}')"
          aria-label="Add ${m.name}">+ Add</button>
      </div>
    `).join('');
  }
}

// ── WEBSOCKET ─────────────────────────────────────────────────────────────────
function connectWS() {
  try {
    ws = new WebSocket(`${WS}`);
    
    ws.onopen = () => {
      wsConnected = true;
      updateStatusBanner('Connected to live updates', 'success');
    };
    
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      
      if (msg.event === 'order_status_changed') {
        const order = orders.find(o => o.id === msg.data.id);
        if (order) {
          order.status = msg.data.status;
          updateStatusBanner(`📦 Order #${order.id}: ${msg.data.status}`, 'info');
        }
      }
    };
    
    ws.onclose = () => {
      wsConnected = false;
      updateStatusBanner('Lost connection to server', 'warning');
      setTimeout(connectWS, 5000);
    };
    
    ws.onerror = () => {
      ws.close();
    };
  } catch (e) {
    console.error('WebSocket error:', e);
  }
}

function updateStatusBanner(msg, type = 'info') {
  const banner = document.getElementById('statusBanner');
  banner.textContent = msg;
  const colors = {
    success: 'background:#10b981;',
    warning: 'background:#f59e0b;',
    error: 'background:#ef4444;',
    info: 'background:#3b82f6;',
  };
  banner.style.cssText = `${colors[type] || colors.info} display:flex; position:fixed; top:0; left:0; right:0; z-index:999; padding:10px 20px; justify-content:center; align-items:center; font-weight:600; font-size:0.9rem; color:#fff; letter-spacing:0.02em; box-shadow:0 2px 12px rgba(0,0,0,0.25); transition:background 0.4s;`;
  
  setTimeout(() => {
    banner.style.display = 'none';
  }, 4000);
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ── INIT ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  initFromURL();
  loadMenu();
  connectWS();
  updateCartUI();
  
  // Register Service Worker for PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('SW registration failed:', err));
  }
});

// Close drawer on overlay click
document.getElementById('cartOverlay')?.addEventListener('click', closeCart);

/* ══════════════════════════════════════════════════
   CSPC Lost & Found — Shared App Logic (app.js)
   ══════════════════════════════════════════════════ */

const STORAGE_KEY = 'cspc_lostfound_items';
const CLAIMS_KEY  = 'cspc_lostfound_claims';
/* ── Categories ── */
const CATEGORIES = [
  'Electronics',
  'Clothing & Accessories',
  'Books & Documents',
  'Bags & Wallets',
  'Keys',
  'Jewelry',
  'Sports Equipment',
  'School Supplies',
  'ID / Cards',
  'Others',
];

/* ── Campus Locations ── */
const LOCATIONS = [
  'Main Building',
  'Library',
  'Cafeteria / Canteen',
  'Gymnasium',
  'Engineering Building',
  'Computer Laboratory',
  'Parking Area',
  'Chapel',
  'Admin Office',
  'Science Building',
  'Campus Grounds',
  'Other',
];

/* ══════════════════════════════════
   STORAGE HELPERS
   ══════════════════════════════════ */

function getItems() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch { return []; }
}

function saveItems(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function getClaims() {
  try {
    return JSON.parse(localStorage.getItem(CLAIMS_KEY)) || [];
  } catch { return []; }
}

function saveClaims(claims) {
  localStorage.setItem(CLAIMS_KEY, JSON.stringify(claims));
}

function getItemById(id) {
  return getItems().find(i => i.id === id) || null;
}

function addItem(item) {
  const items = getItems();
  item.id = 'item-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  item.createdAt = new Date().toISOString();
  items.unshift(item);
  saveItems(items);
  return item;
}

function updateItemStatus(id, status) {
  const items = getItems();
  const idx = items.findIndex(i => i.id === id);
  if (idx !== -1) {
    items[idx].status = status;
    items[idx].updatedAt = new Date().toISOString();
    saveItems(items);
    return true;
  }
  return false;
}

function deleteItem(id) {
  const items = getItems().filter(i => String(i.id) !== String(id));
  saveItems(items);
}

function addClaim(claim) {
  const claims = getClaims();
  claim.id = 'claim-' + Date.now();
  claim.createdAt = new Date().toISOString();
  claim.claimStatus = 'pending';
  claims.unshift(claim);
  saveClaims(claims);
  return claim;
}

function updateClaimStatus(id, status) {
  const claims = getClaims();
  const idx = claims.findIndex(c => c.id === id);
  if (idx !== -1) {
    claims[idx].claimStatus = status;
    saveClaims(claims);
  }
}

/* ══════════════════════════════════
   SEED / INIT
   ══════════════════════════════════ */

function initSeeds() {
  const items = getItems();
  const userItems = items.filter(item => !String(item.id).startsWith('seed-'));
  if (userItems.length !== items.length) saveItems(userItems);
}

/* ══════════════════════════════════
   UTILITY
   ══════════════════════════════════ */

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function statusBadge(status) {
  const map = {
    lost:    { label: 'Lost',    cls: 'badge-lost'    },
    found:   { label: 'Found',   cls: 'badge-found'   },
    claimed: { label: 'Claimed', cls: 'badge-claimed' },
  };
  const b = map[status] || { label: status, cls: '' };
  return `<span class="badge ${b.cls}">${b.label}</span>`;
}

function typeBadge(type) {
  const cls = type === 'lost' ? 'badge-lost' : 'badge-found';
  return `<span class="badge ${cls}">${type === 'lost' ? '🔍 Lost' : '📦 Found'}</span>`;
}

function categoryIcon(cat) {
  const icons = {
    'Electronics': '📱',
    'Clothing & Accessories': '👕',
    'Books & Documents': '📚',
    'Bags & Wallets': '🎒',
    'Keys': '🔑',
    'Jewelry': '💍',
    'Sports Equipment': '⚽',
    'School Supplies': '✏️',
    'ID / Cards': '🪪',
    'Others': '📦',
  };
  return icons[cat] || '📦';
}

function getQueryParam(key) {
  return new URLSearchParams(window.location.search).get(key);
}

function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✅' : '⚠️'}</span> ${message}`;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

/* ══════════════════════════════════
   SHARED NAV RENDER
   ══════════════════════════════════ */

function renderNav(activePage = '') {
  const pages = [
    { href: 'index.html',       label: 'Dashboard' },
    { href: 'browse.html',      label: 'Browse'    },
    { href: 'report-lost.html', label: 'Report Lost'  },
    { href: 'report-found.html',label: 'Report Found' },
    { href: 'admin.html',       label: 'Admin'     },
  ];

  const links = pages.map(p =>
    `<a href="${p.href}" class="${activePage === p.href ? 'nav-active' : ''}">${p.label}</a>`
  ).join('');

  return `
  <nav class="navbar">
    <div class="navbar-container">
      <a href="index.html" class="nav-logo">
        <img src="cspc-logo.png" alt="CSPC Logo" />
        <span class="nav-logo-full">Back2You</span>
        <span class="nav-logo-short">Back2You</span>
      </a>
      <div class="nav-links" id="navLinks">
        ${links}
      </div>
      <div class="nav-actions">
        <button type="button" class="theme-toggle" id="themeToggleBtn" title="Toggle Theme" aria-label="Toggle theme">
          <span class="theme-toggle-icon">🌙</span>
        </button>
        <button class="menu-toggle" id="menuToggle" aria-label="Toggle navigation menu">
          <span></span><span></span><span></span>
        </button>
      </div>
    </div>
  </nav>`;
}



/* ══════════════════════════════════
   ITEM CARD BUILDER
   ══════════════════════════════════ */

function buildItemCard(item) {
  const dateLabel = item.type === 'lost'
    ? `Lost: ${formatDate(item.dateLost)}`
    : `Found: ${formatDate(item.dateFound)}`;

  const photoUrl = (item.imageUrl || item.photo) && item.id
    ? `/api/items/${encodeURIComponent(item.id)}/photo`
    : (item.imageUrl || item.photo || '');
  const thumb = photoUrl
    ? `<img src="${photoUrl}" alt="${item.title}" class="card-thumb" onerror="this.replaceWith(document.createTextNode('Photo unavailable'))">`
    : `<div class="card-thumb-placeholder">${categoryIcon(item.category)}</div>`;

  return `
  <a class="item-card" href="item-detail.html?id=${item.id}">
    <div class="item-card-top">
      ${thumb}
      <div class="item-card-badges">
        ${typeBadge(item.type)}
        ${statusBadge(item.status)}
      </div>
    </div>
    <div class="item-card-body">
      <p class="item-card-category">${categoryIcon(item.category)} ${item.category}</p>
      <h3 class="item-card-title">${escHtml(item.title)}</h3>
      <p class="item-card-desc">${escHtml(item.description).substring(0, 90)}…</p>
      <div class="item-card-meta">
        <span>📍 ${escHtml(item.location)}</span>
        <span>🗓️ ${dateLabel}</span>
      </div>
    </div>
  </a>`;
}

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* Shared data initialization */
document.addEventListener('DOMContentLoaded', initSeeds);

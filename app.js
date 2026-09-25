/* ══════════════════════════════════════════════════
   CSPC Lost & Found — Shared App Logic (app.js)
   ══════════════════════════════════════════════════ */

const STORAGE_KEY = 'cspc_lostfound_items';
const CLAIMS_KEY  = 'cspc_lostfound_claims';
const ADMIN_PIN   = '1234';

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

/* ── Seed Data ── */
const SEED_ITEMS = [
  {
    id: 'seed-001',
    type: 'lost',
    title: 'Black Samsung Galaxy A54',
    category: 'Electronics',
    description: 'Black Samsung Galaxy A54 with a cracked screen protector. Has a dark green rubber case. Last seen near the Engineering Building restroom.',
    dateLost: '2026-09-10',
    location: 'Engineering Building',
    reporterName: 'Maria Santos',
    reporterContact: '09171234567',
    reporterEmail: 'maria.santos@cspc.edu.ph',
    status: 'lost',
    createdAt: '2026-09-10T08:32:00',
    imageUrl: '',
  },
  {
    id: 'seed-002',
    type: 'found',
    title: 'Blue Jansport Backpack',
    category: 'Bags & Wallets',
    description: 'Blue Jansport backpack found near the library entrance. Contains books and a pencil case inside.',
    dateFound: '2026-09-11',
    location: 'Library',
    reporterName: 'Jose Reyes',
    reporterContact: '09281234567',
    reporterEmail: 'jose.reyes@cspc.edu.ph',
    status: 'found',
    createdAt: '2026-09-11T10:15:00',
    imageUrl: '',
  },
  {
    id: 'seed-003',
    type: 'lost',
    title: 'CSPC Student ID — Ana Lim',
    category: 'ID / Cards',
    description: 'CSPC student ID belonging to Ana Lim, Course: BSIT-2A. Please return to admin office or contact owner.',
    dateLost: '2026-09-12',
    location: 'Cafeteria / Canteen',
    reporterName: 'Ana Lim',
    reporterContact: '09331234567',
    reporterEmail: 'ana.lim@cspc.edu.ph',
    status: 'lost',
    createdAt: '2026-09-12T12:45:00',
    imageUrl: '',
  },
  {
    id: 'seed-004',
    type: 'found',
    title: 'Set of Keys (3 keys, red lanyard)',
    category: 'Keys',
    description: 'Found a set of 3 keys on a red lanyard near the gymnasium entrance. Appears to be house/room keys.',
    dateFound: '2026-09-12',
    location: 'Gymnasium',
    reporterName: 'Security Guard - Post 2',
    reporterContact: '09451234567',
    reporterEmail: 'security@cspc.edu.ph',
    status: 'found',
    createdAt: '2026-09-12T14:00:00',
    imageUrl: '',
  },
  {
    id: 'seed-005',
    type: 'found',
    title: 'Casio Scientific Calculator (FX-991ES)',
    category: 'Electronics',
    description: 'White Casio FX-991ES Plus scientific calculator found in the Computer Laboratory, Room 204. Name written inside: "R. Cruz".',
    dateFound: '2026-09-13',
    location: 'Computer Laboratory',
    reporterName: 'Lab Instructor',
    reporterContact: '09561234567',
    reporterEmail: 'lab@cspc.edu.ph',
    status: 'claimed',
    createdAt: '2026-09-13T09:20:00',
    imageUrl: '',
  },
  {
    id: 'seed-006',
    type: 'lost',
    title: 'Silver Bracelet with Name Engraving',
    category: 'Jewelry',
    description: 'Silver bracelet with "Sofia" engraved on it. Lost somewhere between the Admin Office and the Main Building lobby.',
    dateLost: '2026-09-13',
    location: 'Main Building',
    reporterName: 'Sofia Dela Cruz',
    reporterContact: '09671234567',
    reporterEmail: 'sofia.delacruz@cspc.edu.ph',
    status: 'lost',
    createdAt: '2026-09-13T13:10:00',
    imageUrl: '',
  },
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
  const items = getItems().filter(i => i.id !== id);
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
  if (localStorage.getItem('cspc_seeded')) return;
  saveItems(SEED_ITEMS);
  localStorage.setItem('cspc_seeded', '1');
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
      <div class="nav-logo">
        <span class="logo-icon">🔍</span> CSPC Lost &amp; Found
      </div>
      <div class="nav-links" id="navLinks">${links}</div>
      <button class="menu-toggle" id="menuToggle" aria-label="Toggle menu">
        <span></span><span></span><span></span>
      </button>
    </div>
  </nav>`;
}

function initNav() {
  const toggle = document.getElementById('menuToggle');
  const links  = document.getElementById('navLinks');
  if (toggle && links) {
    toggle.addEventListener('click', () => links.classList.toggle('open'));
  }
}

/* ══════════════════════════════════
   ITEM CARD BUILDER
   ══════════════════════════════════ */

function buildItemCard(item) {
  const dateLabel = item.type === 'lost'
    ? `Lost: ${formatDate(item.dateLost)}`
    : `Found: ${formatDate(item.dateFound)}`;

  const thumb = item.imageUrl
    ? `<img src="${item.imageUrl}" alt="${item.title}" class="card-thumb">`
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
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ══════════════════════════════════
   SHARED EXTRA STYLES (injected)
   ══════════════════════════════════ */

function injectSharedStyles() {
  const style = document.createElement('style');
  style.textContent = `
    /* ── Badges ── */
    .badge {
      display: inline-block;
      padding: 0.18rem 0.6rem;
      border-radius: 6px;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .badge-lost    { background: rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); }
    .badge-found   { background: rgba(34,197,94,0.13); color:#4ade80; border:1px solid rgba(34,197,94,0.3); }
    .badge-claimed { background: rgba(234,179,8,0.13); color:#facc15; border:1px solid rgba(234,179,8,0.3); }

    /* ── Item Cards ── */
    .item-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 14px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      text-decoration: none;
      color: var(--text-main);
      transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
    }
    .item-card:hover {
      border-color: rgba(234,179,8,0.5);
      box-shadow: 0 0 24px rgba(250,204,21,0.12);
      transform: translateY(-3px);
    }
    .item-card-top {
      position: relative;
      height: 130px;
      overflow: hidden;
      background: rgba(255,255,255,0.03);
    }
    .card-thumb {
      width: 100%; height: 100%;
      object-fit: cover;
    }
    .card-thumb-placeholder {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      font-size: 3rem;
      background: rgba(250,204,21,0.05);
    }
    .item-card-badges {
      position: absolute;
      top: 0.6rem; left: 0.6rem;
      display: flex; gap: 0.3rem;
      flex-wrap: wrap;
    }
    .item-card-body {
      padding: 1rem 1.1rem 1.2rem;
      display: flex; flex-direction: column; gap: 0.4rem;
    }
    .item-card-category {
      font-size: 0.72rem; font-weight: 600;
      color: var(--yellow-dark); letter-spacing: 0.06em;
    }
    .item-card-title {
      font-size: 0.95rem; font-weight: 700;
      color: var(--text-main); line-height: 1.3;
    }
    .item-card-desc {
      font-size: 0.82rem; color: var(--text-muted); line-height: 1.5;
    }
    .item-card-meta {
      display: flex; flex-direction: column; gap: 0.15rem;
      font-size: 0.75rem; color: var(--text-muted); margin-top: 0.35rem;
    }

    /* ── Forms ── */
    .form-group { display: flex; flex-direction: column; gap: 0.4rem; }
    .form-label { font-size: 0.8rem; font-weight: 600; color: var(--yellow-light); letter-spacing: 0.04em; }
    .form-label .required { color: #f87171; margin-left: 2px; }
    .form-control {
      background: rgba(255,255,255,0.05);
      border: 1.5px solid rgba(250,204,21,0.2);
      border-radius: 8px;
      padding: 0.65rem 0.9rem;
      color: var(--text-main);
      font-size: 0.9rem;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
      width: 100%;
    }
    .form-control:focus {
      border-color: rgba(250,204,21,0.55);
      box-shadow: 0 0 0 3px rgba(250,204,21,0.08);
    }
    .form-control::placeholder { color: var(--text-muted); }
    select.form-control option { background: #27272a; color: var(--text-main); }
    textarea.form-control { resize: vertical; min-height: 100px; }

    /* ── Stat Cards ── */
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 1.4rem 1.5rem;
      display: flex; flex-direction: column; gap: 0.5rem;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .stat-card:hover {
      border-color: rgba(234,179,8,0.4);
      box-shadow: 0 0 18px rgba(250,204,21,0.1);
    }
    .stat-icon { font-size: 1.8rem; }
    .stat-number { font-size: 2rem; font-weight: 900; color: var(--yellow-main); line-height: 1; }
    .stat-label  { font-size: 0.78rem; font-weight: 600; color: var(--text-muted); letter-spacing: 0.05em; }

    /* ── Toast ── */
    .toast {
      position: fixed;
      bottom: 1.5rem; right: 1.5rem;
      background: #27272a;
      border: 1px solid rgba(250,204,21,0.3);
      border-radius: 10px;
      padding: 0.85rem 1.2rem;
      font-size: 0.875rem;
      color: var(--text-main);
      box-shadow: 0 4px 24px rgba(0,0,0,0.5);
      z-index: 9999;
      opacity: 0;
      transform: translateY(12px);
      transition: opacity 0.3s, transform 0.3s;
      display: flex; align-items: center; gap: 0.5rem;
      max-width: 320px;
    }
    .toast.show { opacity:1; transform:translateY(0); }
    .toast-error { border-color: rgba(239,68,68,0.4); }

    /* ── Modal ── */
    .modal-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.65);
      backdrop-filter: blur(4px);
      z-index: 1000;
      display: flex; align-items: center; justify-content: center;
      padding: 1rem;
      opacity: 0; pointer-events: none;
      transition: opacity 0.25s;
    }
    .modal-backdrop.open { opacity:1; pointer-events:all; }
    .modal {
      background: #1f1f23;
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 2rem;
      max-width: 480px;
      width: 100%;
      transform: translateY(20px);
      transition: transform 0.25s;
    }
    .modal-backdrop.open .modal { transform: translateY(0); }
    .modal h3 { font-size: 1.1rem; font-weight: 800; color: var(--text-main); margin-bottom: 1rem; }
    .modal-close {
      float:right; background:none; border:none; color:var(--text-muted);
      font-size:1.3rem; cursor:pointer; line-height:1;
    }
    .modal-close:hover { color: var(--yellow-main); }

    /* ── Page Header ── */
    .page-header {
      max-width: 960px;
      margin: 0 auto;
      padding: 3rem 1.5rem 1.5rem;
      position: relative; z-index: 1;
    }
    .page-header h1 {
      font-size: clamp(1.6rem, 4vw, 2.4rem);
      font-weight: 900;
      background: linear-gradient(90deg, #ffffff 40%, #eab308 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 0.4rem;
    }
    .page-header p {
      font-size: 0.9rem; color: var(--text-muted); line-height: 1.6;
    }

    /* ── Section wrapper ── */
    .page-section {
      max-width: 960px;
      margin: 0 auto;
      padding: 1.5rem 1.5rem 5rem;
      position: relative; z-index: 1;
    }

    /* ── Nav active ── */
    .nav-active { color: var(--yellow-main) !important; }

    /* ── Empty state ── */
    .empty-state {
      text-align: center;
      padding: 4rem 1rem;
      color: var(--text-muted);
    }
    .empty-state-icon { font-size: 3.5rem; margin-bottom: 1rem; }
    .empty-state h3 { font-size: 1rem; font-weight: 700; color: var(--text-main); margin-bottom: 0.5rem; }
    .empty-state p  { font-size: 0.875rem; }
  `;
  document.head.appendChild(style);
}

/* ── Auto-init on load ── */
document.addEventListener('DOMContentLoaded', () => {
  initSeeds();
  injectSharedStyles();
});

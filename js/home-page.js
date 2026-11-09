// Home page behaviour (items feed, reporting, belongings, notifications).
let currentUser = null;
let currentFilter = 'all';
let currentLocationFilter = '';
let currentSort = 'newest';
let currentPage = 1;
const itemsPerPage = 12;
let loadedItems = [];
let itemsRequestId = 0;
let searchDebounceTimer = null;
let pendingScrollItemId = null;
let pendingStartPage = null;
const FEED_FILTERS = ['all', 'lost', 'found', 'claimed', 'registered'];
const FEED_SORTS = ['newest', 'oldest', 'title'];

function clearStoredAuth() {
  ['adminToken', 'currentUser', 'userRole'].forEach(key => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  });
}

function renderGuestHeader() {
  currentUser = null;
  const slot = document.getElementById('userNavSlot');
  const chipVault = document.getElementById('chipMyBelongings');
  const mobileLogout = document.getElementById('mobileMenuLogout');
  if (slot) slot.innerHTML = '<a href="/login" class="btn btn-primary nav-signin-btn">Sign In</a>';
  if (chipVault) chipVault.style.display = 'none';
  if (mobileLogout) mobileLogout.classList.remove('visible');
}

function renderAuthenticatedHeader(user) {
  currentUser = user;
  const isAdmin = user.role === 'admin';
  const slot = document.getElementById('userNavSlot');
  const mobileLogout = document.getElementById('mobileMenuLogout');
  const chipVault = document.getElementById('chipMyBelongings');
  if (mobileLogout) mobileLogout.classList.add('visible');
  if (slot) {
    slot.innerHTML = `
      <button type="button" id="notifBellBtn" data-action="openNotificationsModal" class="notif-bell-btn" title="View QR Recovery Alerts">
        <span class="notif-icon" aria-hidden="true">🔔</span><span id="notifCountBadge" class="notif-badge" style="display:none;">0</span>
      </button>
      <div class="user-pill">
        <button type="button" class="user-name user-name-btn" data-action="openChangePasswordModal" title="Account settings: change password">${escapeHtml(isAdmin ? 'Admin' : user.fullName)}</button>
        ${isAdmin ? '' : '<span class="role-badge">Student</span>'}
        <button type="button" data-action="handleLogout" class="user-pill-logout" title="Sign out of account">Logout</button>
      </div>
    `;
  }
  if (chipVault) chipVault.style.display = 'inline-block';
}

async function checkAuthSession() {
  try {
    const res = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) throw new Error('Unable to verify the current session.');
    const data = await res.json();

    if (data.authenticated && data.user && ['admin', 'student'].includes(data.user.role)) {
      currentUser = data.user;
      if (currentUser.role === 'student') installDashboardBackGuard();
      if (currentUser.role === 'admin' && window.location.pathname === '/') {
        window.location.replace('/admin.html');
        return;
      }
      sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
      sessionStorage.setItem('userRole', currentUser.role);
      renderAuthenticatedHeader(currentUser);
      fetchMyBelongingsCount();
      loadMyNotifications();
      // Refresh with the signed-in view (owner actions) without losing the current page.
      fetchAndRenderItems({ keepPage: true });

      if (currentUser.role !== 'admin' && !document.getElementById('itemContact').value) {
        document.getElementById('itemContact').value = `${currentUser.fullName} (${currentUser.email})`;
      }
    } else {
      clearStoredAuth();
      renderGuestHeader();
    }
  } catch (err) {
    try {
      const cachedUser = JSON.parse(sessionStorage.getItem('currentUser') || 'null');
      if (cachedUser && ['admin', 'student'].includes(cachedUser.role)
        && sessionStorage.getItem('userRole') === cachedUser.role) {
        renderAuthenticatedHeader(cachedUser);
        if (cachedUser.role === 'student') installDashboardBackGuard();
        return;
      }
    } catch (storageError) {
      // Ignore unreadable cached state and leave authentication to the next request.
    }
  }
}

function openChangePasswordModal() {
  if (!currentUser) return;
  document.getElementById('changePasswordEmail').textContent = currentUser.email || '';
  document.getElementById('changePasswordError').style.display = 'none';
  document.getElementById('changePasswordModal').classList.add('open');
  document.getElementById('currentPassword').focus();
}

function closeChangePasswordModal() {
  document.getElementById('changePasswordModal').classList.remove('open');
  document.getElementById('changePasswordForm').reset();
}

async function handleChangePassword(event) {
  event.preventDefault();
  const errorBox = document.getElementById('changePasswordError');
  const showChangeError = message => {
    errorBox.textContent = message;
    errorBox.style.display = 'block';
  };
  errorBox.style.display = 'none';
  const newPassword = document.getElementById('newPassword').value;
  if (newPassword !== document.getElementById('newPasswordConfirm').value) {
    showChangeError('The two new passwords do not match.');
    return;
  }
  const button = document.getElementById('changePasswordSubmit');
  button.disabled = true;
  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ currentPassword: document.getElementById('currentPassword').value, newPassword })
    });
    const data = await res.json();
    if (data.success) {
      closeChangePasswordModal();
      showToast(data.message);
    } else {
      showChangeError(data.message || 'Could not change the password.');
    }
  } catch (err) {
    showChangeError('Network error. Please try again.');
  } finally {
    button.disabled = false;
  }
}

function openLogoutModal() {
  document.getElementById('logoutConfirmModal').classList.add('open');
}
function closeLogoutModal() {
  document.getElementById('logoutConfirmModal').classList.remove('open');
}
async function executeLogout() {
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Logout request failed.');
    clearStoredAuth();
    renderGuestHeader();
    closeLogoutModal();
    fetchAndRenderItems();
    showToast('Signed out successfully.');
  } catch (err) {
    showToast('Unable to sign out. Please try again.', true);
  }
}
function handleLogout() {
  openLogoutModal();
}

async function fetchStats() {
  try {
    let res = await fetch('/api/items/stats');
    if (!res.ok) res = await fetch('/api/stats');
    const data = await res.json();
    if (data.success && data.stats) {
      document.getElementById('statTotal').innerText = data.stats.total;
      document.getElementById('statLost').innerText = data.stats.lost;
      document.getElementById('statFound').innerText = data.stats.found;
      document.getElementById('statClaimed').innerText = data.stats.claimed;
    }
  } catch (err) {
    if (typeof loadedItems !== 'undefined' && loadedItems && loadedItems.length > 0) {
      document.getElementById('statTotal').innerText = loadedItems.length;
      document.getElementById('statLost').innerText = loadedItems.filter(i => i.type === 'lost').length;
      document.getElementById('statFound').innerText = loadedItems.filter(i => i.type === 'found').length;
      document.getElementById('statClaimed').innerText = loadedItems.filter(i => i.claimed || i.status === 'claimed').length;
    }
  }
}

async function fetchMyBelongingsCount() {
  if (!currentUser) return;
  try {
    const res = await fetch('/api/items?type=registered');
    const data = await res.json();
    if (data.success) {
      const el = document.getElementById('myBelongingsCount');
      if (el) el.innerText = data.items.length;
    }
  } catch (e) {}
}

// ── Feed state in the address bar (reload / share keeps the current view) ──
function syncFeedUrl() {
  const url = new URL(window.location.href);
  const setParam = (key, value) => {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  };
  setParam('filter', currentFilter === 'all' ? '' : currentFilter);
  setParam('q', document.getElementById('searchInput').value.trim());
  setParam('location', document.getElementById('locationFilterSelect').value);
  setParam('sort', currentSort === 'newest' ? '' : currentSort);
  setParam('page', currentPage > 1 ? String(currentPage) : '');
  // One-time parameters from email links have been applied by now.
  url.searchParams.delete('search');
  url.searchParams.delete('matchItemId');
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url);
}

function setSelectValue(select, value) {
  if (!select) return;
  select.value = value;
  if (typeof syncButtonSelect === 'function') syncButtonSelect(select);
}

function restoreFeedFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const filter = params.get('filter');
  if (FEED_FILTERS.includes(filter)) currentFilter = filter;
  const sort = params.get('sort');
  if (FEED_SORTS.includes(sort)) currentSort = sort;
  setSelectValue(document.getElementById('sortSelect'), currentSort);
  const query = params.get('q') ?? (params.get('matchItemId') ? params.get('search') : null);
  if (query) document.getElementById('searchInput').value = query;
  const locationSelect = document.getElementById('locationFilterSelect');
  const location = params.get('location');
  if (location && [...locationSelect.options].some(option => option.value === location)) {
    setSelectValue(locationSelect, location);
    currentLocationFilter = location.toLowerCase();
  }
  pendingScrollItemId = params.get('matchItemId');
  const page = Number.parseInt(params.get('page'), 10);
  pendingStartPage = page > 1 ? page : null;
  updateFilterUi();
}

function sortItems(items) {
  const time = item => Date.parse(item.createdAt || item.date || '') || 0;
  const sorted = items.map((item, index) => ({ item, index }));
  sorted.sort((a, b) => {
    if (currentSort === 'title') return (a.item.title || '').localeCompare(b.item.title || '', undefined, { sensitivity: 'base' }) || a.index - b.index;
    const diff = currentSort === 'oldest' ? time(a.item) - time(b.item) : time(b.item) - time(a.item);
    return diff || a.index - b.index;
  });
  return sorted.map(entry => entry.item);
}

function setSortOrder(value) {
  currentSort = FEED_SORTS.includes(value) ? value : 'newest';
  currentPage = 1;
  loadedItems = sortItems(loadedItems);
  renderItemsGrid(loadedItems);
  syncFeedUrl();
}

// Wait until typing pauses instead of querying the server on every keystroke.
function scheduleItemsSearch() {
  window.clearTimeout(searchDebounceTimer);
  searchDebounceTimer = window.setTimeout(() => fetchAndRenderItems(), 250);
}

function hasActiveFeedFilters() {
  return currentFilter !== 'all' || Boolean(currentLocationFilter) || Boolean(document.getElementById('searchInput').value.trim());
}

function resetItemFilters() {
  document.getElementById('searchInput').value = '';
  setSelectValue(document.getElementById('locationFilterSelect'), '');
  currentLocationFilter = '';
  setFilter('all');
}

function startReport(type) {
  const typeInput = document.querySelector(`input[name="itemType"][value="${type}"]`);
  if (typeInput) typeInput.checked = true;
  updateTypeRadio();
  document.getElementById('itemForm').scrollIntoView({ behavior: 'smooth' });
}

function showItemsLoading(grid) {
  grid.setAttribute('aria-busy', 'true');
  if (grid.querySelector('.project-card')) {
    grid.classList.add('is-loading');
    return;
  }
  grid.innerHTML = Array.from({ length: 3 }, () => `
    <div class="project-card skeleton-card" aria-hidden="true">
      <span class="skeleton-line skeleton-line--short"></span>
      <span class="skeleton-line"></span>
      <span class="skeleton-block"></span>
      <span class="skeleton-line"></span>
    </div>`).join('') + '<span class="visually-hidden" role="status">Loading items…</span>';
}

function showItemsError(grid) {
  document.getElementById('itemsPagination').innerHTML = '';
  updateItemsSummary(0);
  grid.innerHTML = `
    <div class="feed-empty feed-empty--error" role="alert">
      <p class="feed-empty-title">Couldn't load campus items</p>
      <p class="feed-empty-text">Check your connection and try again.</p>
      <div class="feed-empty-actions">
        <button type="button" class="btn btn-outline" data-action="fetchAndRenderItems">Try again</button>
      </div>
    </div>`;
}

async function fetchAndRenderItems(options = {}) {
  const requestId = ++itemsRequestId;
  if (!options.keepPage) currentPage = 1;
  const grid = document.getElementById('itemsGrid');
  showItemsLoading(grid);
  const search = document.getElementById('searchInput').value.trim();
  const params = new URLSearchParams();

  if (currentFilter === 'lost') params.append('type', 'lost');
  if (currentFilter === 'found') params.append('type', 'found');
  if (currentFilter === 'claimed') params.append('status', 'claimed');
  if (currentFilter === 'registered') params.append('type', 'registered');
  if (currentLocationFilter) params.append('location', currentLocationFilter);
  if (search) params.append('search', search);

  try {
    const res = await fetch(`/api/items?${params.toString()}`);
    // A newer search or filter change has started; its result wins.
    if (requestId !== itemsRequestId) return;
    if (res.status === 401 && currentFilter === 'registered') {
      // "My Belongings" needs a session; fall back to the public feed.
      currentFilter = 'all';
      updateFilterUi();
      fetchAndRenderItems();
      return;
    }
    const data = await res.json();
    if (requestId !== itemsRequestId) return;
    if (!data.success) throw new Error(data.message || 'Could not load items.');
    loadedItems = sortItems(data.items);
    if (pendingStartPage) {
      currentPage = pendingStartPage;
      pendingStartPage = null;
    }
    renderItemsGrid(loadedItems);
    syncFeedUrl();
    if (pendingScrollItemId) {
      const matchCard = document.getElementById(`item-card-${pendingScrollItemId}`);
      if (matchCard) matchCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      pendingScrollItemId = null;
    }
    fetchStats();
  } catch (err) {
    if (requestId === itemsRequestId) showItemsError(grid);
  } finally {
    if (requestId === itemsRequestId) {
      grid.removeAttribute('aria-busy');
      grid.classList.remove('is-loading');
    }
  }
}

function renderItemsGrid(items) {
  const grid = document.getElementById('itemsGrid');
  const pagination = document.getElementById('itemsPagination');
  grid.classList.toggle('registered-belongings-grid', currentFilter === 'registered');

  if (!items || items.length === 0) {
    pagination.innerHTML = '';
    updateItemsSummary(0);
    if (currentFilter === 'registered') {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3.5rem 1rem; background: rgba(59,130,246,0.06); border: 1.5px dashed rgba(59,130,246,0.35); border-radius: 16px;">
          <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🏷️</div>
          <h3 style="font-size: 1.15rem; font-weight: 800; color: #93c5fd; margin-bottom: 0.4rem;">Your Belongings Vault is Empty</h3>
          <p style="font-size: 0.84rem; color: var(--text-muted); max-width: 480px; margin: 0 auto 1.25rem; line-height: 1.5;">
            Register your personal laptops, tumblers, water bottles, and binder folders before they get lost to generate your unique, anonymous QR recovery sticker!
          </p>
          <button class="btn btn-primary" data-action="handleOpenRegisterBelonging">+ Register a Belonging Now</button>
        </div>
      `;
      return;
    }

    const filtered = hasActiveFeedFilters();
    grid.innerHTML = `
      <div class="feed-empty">
        <p class="feed-empty-title">No items found</p>
        <p class="feed-empty-text">${filtered
          ? 'Nothing matches the current search or filters. Try different words or clear the filters.'
          : 'No items have been reported yet.'}</p>
        <div class="feed-empty-actions">
          ${filtered ? '<button type="button" class="btn btn-outline" data-action="resetItemFilters">Clear filters</button>' : ''}
          <button type="button" class="btn btn-primary" data-action="startReport" data-args='["lost"]'>Report a lost item</button>
        </div>
      </div>
    `;
    return;
  }

  const totalPages = Math.ceil(items.length / itemsPerPage);
  if (currentPage > totalPages) currentPage = totalPages;
  const pageItems = items.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  grid.innerHTML = pageItems.map((item, itemIndex) => {
    // Special render for personal preventive registered belongings
    if (item.type === 'registered') {
      return `
        <div class="project-card registered-belonging-card" id="item-card-${item.id}">
          <div class="project-card-header registered-card-header" style="position: relative;">
            <div class="item-card-header-content registered-card-header-content">
              <div class="item-card-meta-row registered-card-meta-row">
                <div class="item-card-category-ref">
                  <span class="project-type registered-belonging-category" title="${escapeHtml(item.category)}">${escapeHtml(item.category)}</span>
                  <span class="ref-code registered-belonging-ref" title="${escapeHtml(item.refCode || '')}">${escapeHtml(item.refCode || '')}</span>
                </div>
                <span class="item-badge badge-registered">🔒 Registered Belonging</span>
              </div>
              <h3 class="registered-belonging-title" style="margin-top: 0.35rem;">${escapeHtml(item.title)}</h3>
            </div>
            <div class="belonging-menu-wrap">
              <button type="button" class="belonging-menu-button" aria-label="More options for ${escapeHtml(item.title)}" aria-haspopup="menu" aria-expanded="false" data-action="toggleBelongingMenu" data-args="${actionArgs('$event', item.id)}">&#8942;</button>
              <div class="belonging-menu" id="belonging-menu-${escapeHtml(item.id)}" role="menu">
                <button type="button" role="menuitem" data-action="editRegisteredBelonging" data-args="${actionArgs('$event', item.id)}"><svg class="belonging-menu-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg><span>Edit Details</span></button>
                <button type="button" role="menuitem" class="danger" data-action="deleteRegisteredBelonging" data-args="${actionArgs('$event', item.id)}"><svg class="belonging-menu-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg><span>Delete Item</span></button>
              </div>
            </div>
          </div>

          <div class="registered-belonging-protection">
            🛡️ <strong>Preventive Protection Active:</strong> Paste QR sticker onto this item. If someone scans it, an anonymous notification goes straight to your account.
          </div>

          <p class="item-card-description" style="margin-top: 0.25rem;">${escapeHtml(item.desc)}</p>

          <div class="card-meta-line">
            <span><strong>Primary Building:</strong> ${escapeHtml(item.location)}</span>
            <span><strong>Registered:</strong> ${formatTimestamp(item.createdAt || item.date)}</span>
            ${cleanFinderInstructions(item.instructions) ? `<span><strong>Finder Instructions:</strong> ${escapeHtml(cleanFinderInstructions(item.instructions))}</span>` : ''}
          </div>

          <div class="card-actions" style="margin-top: 1rem;">
            <button class="btn-sm btn-qr" data-action="openQrStickerModal" data-args="${actionArgs(item.id)}">QR Sticker</button>
            <button class="btn-sm btn-outline btn-finder-test" data-action="openAnonymousFinderModal" data-args="${actionArgs(item.refCode)}">Test Finder Screen</button>
          </div>
        </div>
      `;
    }

    let badgeHtml = '';
    if (item.claimed) {
      badgeHtml = '<span class="item-badge badge-claimed">Claimed</span>';
    } else if (item.type === 'lost') {
      badgeHtml = '<span class="item-badge badge-lost">Lost</span>';
    } else {
      badgeHtml = '<span class="item-badge badge-found">Found</span>';
    }

    let matchBadgeHtml = '';
    if (item.potentialMatch && currentUser) {
      matchBadgeHtml = `<button type="button" class="btn-match-qr potential-match-badge" data-action="openMatchQrModal" data-args="${actionArgs(item.id, item.potentialMatch.id)}"><span class="potential-match-shimmer" aria-hidden="true"></span><svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fde68a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z"/></svg><span class="potential-match-label">Potential Match</span></button>`;
    }

    const canDelete = currentUser?.role === 'admin';
    const delBtnHtml = canDelete
      ? `<button class="btn-sm btn-del" data-action="deleteItem" data-args="${actionArgs(item.id)}">Remove</button>`
      : '';
    const actionsHtml = matchBadgeHtml + delBtnHtml;

    const photoUrl = getItemPhotoUrl(item);
    const photoInteraction = photoUrl
      ? `role="button" tabindex="0" aria-label="View photo of ${escapeHtml(item.title)}" data-activate data-action="openImageModal" data-args="${actionArgs(photoUrl, item.title)}"`
      : '';
    // Without a photo, the category icon fills the frame (it also shows if a photo fails to load).
    const photoHtml = `
      <div class="item-photo-container listing-media">
        <div class="item-photo-frame" data-photo-state="${photoUrl ? 'loading' : 'empty'}" ${photoInteraction}>
          ${photoUrl ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(item.title)}" loading="${itemIndex < 2 ? 'eager' : 'lazy'}" fetchpriority="${itemIndex === 0 ? 'high' : 'auto'}" decoding="async" data-item-photo />` : ''}
          <div class="item-photo-status" role="status" aria-live="polite">
            ${photoUrl ? '<span class="item-photo-spinner" aria-hidden="true"></span>' : ''}
            ${categoryIconHtml(item.category, 'listing-placeholder-icon')}
            <span class="item-photo-status-text">${photoUrl ? 'Loading photo...' : 'No photo'}</span>
          </div>
        </div>
      </div>
    `;

    return `
      <article class="project-card listing-card" id="item-card-${item.id}">
        ${photoHtml}
        <div class="listing-body">
          <div class="listing-topline">
            ${badgeHtml}
            ${item.refCode ? `<span class="ref-code listing-ref" title="Reference code">${escapeHtml(item.refCode)}</span>` : ''}
          </div>
          <h3 class="listing-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h3>
          <p class="listing-category">${escapeHtml(item.category || 'Uncategorized')}</p>
          ${item.desc ? `
          <p class="listing-desc">${escapeHtml(item.desc)}</p>
          <button type="button" class="listing-more" data-action="toggleItemDescription" data-args='["$el"]' aria-expanded="false" hidden>Show more</button>` : ''}
          <ul class="listing-facts">
            <li><span class="listing-fact-icon" aria-hidden="true">📍</span><span><span class="visually-hidden">Location: </span>${escapeHtml(item.location || 'Location not given')}</span></li>
            <li><span class="listing-fact-icon" aria-hidden="true">🕐</span><span>${cardTimeHtml(item.createdAt || item.date, 'Reported')}</span></li>
            ${item.claimedAt ? `<li><span class="listing-fact-icon" aria-hidden="true">✅</span><span>${cardTimeHtml(item.claimedAt, 'Claimed')}</span></li>` : ''}
          </ul>
          ${actionsHtml ? `<div class="card-actions listing-actions">${actionsHtml}</div>` : ''}
        </div>
      </article>
    `;
  }).join('');
  renderItemsPagination(totalPages);
  updateItemsSummary(items.length, (currentPage - 1) * itemsPerPage + 1, (currentPage - 1) * itemsPerPage + pageItems.length);
  updateDescriptionToggles(grid);
}

// Category name → icon symbol defined in index.html (#category-icon-*).
const CATEGORY_ICON_IDS = {
  'Electronics': 'electronics',
  'Water Bottles/Tumblers': 'bottle',
  'Clothing & Accessories': 'clothing',
  'Books & Documents': 'books',
  'Bags & Wallets': 'bag',
  'Keys': 'key',
  'Jewelry': 'jewelry',
  'Sports Equipment': 'sports',
  'School Supplies': 'school',
  'ID / Cards': 'id'
};

function categoryIconHtml(category, className) {
  const iconId = CATEGORY_ICON_IDS[category] || 'other';
  return `<svg class="${className}" aria-hidden="true" focusable="false"><use href="#category-icon-${iconId}"></use></svg>`;
}

// "just now", "3 hrs ago", "yesterday", "4 days ago", then the date itself.
function relativeTimeLabel(date) {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return `on ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

// Short label for cards; the exact date and time stay available on hover.
function cardTimeHtml(value, verb) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return `${verb} recently`;
  const exact = `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  return `${verb} <time datetime="${date.toISOString()}" title="${exact}">${relativeTimeLabel(date)}</time>`;
}

function updateItemsSummary(total, start = 0, end = 0) {
  const summary = document.getElementById('itemsSummary');
  if (!summary) return;
  if (!total) {
    summary.textContent = '';
    return;
  }
  const noun = currentFilter === 'registered' ? 'belonging' : 'item';
  summary.textContent = total > itemsPerPage
    ? `Showing ${start}–${end} of ${total} ${noun}s`
    : `${total} ${noun}${total === 1 ? '' : 's'}`;
}

// Descriptions are clamped to a few lines; offer "Show more" only where text is cut off.
function updateDescriptionToggles(root) {
  if (!root) return;
  root.querySelectorAll('.listing-desc').forEach(description => {
    const button = description.nextElementSibling;
    if (!button || !button.classList.contains('listing-more')) return;
    if (description.classList.contains('is-expanded')) {
      button.hidden = false;
      return;
    }
    button.hidden = description.scrollHeight <= description.clientHeight + 1;
  });
}

function toggleItemDescription(button) {
  const description = button.previousElementSibling;
  if (!description) return;
  const expanded = description.classList.toggle('is-expanded');
  button.textContent = expanded ? 'Show less' : 'Show more';
  button.setAttribute('aria-expanded', String(expanded));
}

let descriptionToggleTimer;
window.addEventListener('resize', () => {
  clearTimeout(descriptionToggleTimer);
  descriptionToggleTimer = setTimeout(() => updateDescriptionToggles(document.getElementById('itemsGrid')), 150);
});

function renderItemsPagination(totalPages) {
  const pagination = document.getElementById('itemsPagination');
  if (!pagination || totalPages <= 1) {
    if (pagination) pagination.innerHTML = '';
    return;
  }

  let controls = `<button class="pagination-btn" data-action="goToItemsPage" data-args="${actionArgs(currentPage - 1)}" ${currentPage === 1 ? 'disabled' : ''}>Previous</button>`;
  for (let page = 1; page <= totalPages; page++) {
    controls += `<button class="pagination-btn ${page === currentPage ? 'active' : ''}" data-action="goToItemsPage" data-args="${actionArgs(page)}" aria-label="Page ${page}">${page}</button>`;
  }
  controls += `<button class="pagination-btn" data-action="goToItemsPage" data-args="${actionArgs(currentPage + 1)}" ${currentPage === totalPages ? 'disabled' : ''}>Next</button>`;
  pagination.innerHTML = controls;
}

function goToItemsPage(page) {
  currentPage = page;
  renderItemsGrid(loadedItems);
  syncFeedUrl();
  document.getElementById('items').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function formatTimestamp(isoOrDateStr) {
  if (!isoOrDateStr) return 'Recently';
  const d = new Date(isoOrDateStr);
  if (isNaN(d.getTime())) return escapeHtml(isoOrDateStr);

  const dateFormatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeFormatted = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  let relative = 'Just now';
  if (diffMins >= 1 && diffMins < 60) relative = `${diffMins}m ago`;
  else if (diffHours >= 1 && diffHours < 24) relative = `${diffHours}h ago`;
  else if (diffDays >= 1) relative = `${diffDays}d ago`;

  return `${dateFormatted} at ${timeFormatted} (${relative})`;
}

function updateTypeRadio() {
  const isLost = document.querySelector('input[name="itemType"]:checked').value === 'lost';
  const lblLost = document.getElementById('lblLost');
  const lblFound = document.getElementById('lblFound');

  if (isLost) {
    lblLost.className = 'type-option active-lost';
    lblFound.className = 'type-option';
  } else {
    lblLost.className = 'type-option';
    lblFound.className = 'type-option active-found';
  }
}

function updateFilterUi() {
  document.querySelectorAll('.filter-chips .chip').forEach(chip => {
    const active = chip.dataset.filter === currentFilter;
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('.hero-stats .stat-box').forEach(stat => {
    const active = stat.dataset.filter === currentFilter;
    stat.classList.toggle('active', active);
    stat.setAttribute('aria-pressed', String(active));
  });
}

function setFilter(filter) {
  currentFilter = filter;
  currentPage = 1;
  updateFilterUi();
  fetchAndRenderItems();
}

function setLocationFilter(loc) {
  currentLocationFilter = (loc || '').toLowerCase();
  fetchAndRenderItems();
}

// FEATURE: Digital "Found" QR Code Stickers (Preventive Add-on Feature)
async function openQrStickerModal(id) {
  let item = loadedItems.find(i => String(i.id) === String(id));
  if (!item) {
    try {
      const res = await fetch(`/api/items/${id}`);
      const data = await res.json();
      if (data.success) item = data.item;
    } catch (e) {}
  }
  if (!item) return;

  document.getElementById('qrItemTitle').innerText = item.title;
  const refCode = item.refCode || `CSPC-LF-QR-${item.id}`;
  document.getElementById('qrRefCode').innerText = refCode;

  // Keep the sticker on the same host serving this app.
  const finderUrl = new URL('/found', window.location.origin);
  finderUrl.searchParams.set('ref', refCode);
  document.getElementById('qrCodeImage').src = qrImageUrl(finderUrl.toString());

  toggleAnonymousDemo(false);
  document.getElementById('qrModal').classList.add('open');
}

// QR codes are drawn in the browser so links (and match tokens) never leave this site.
function qrImageUrl(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(6, 2);
}

function closeQrModal() {
  document.getElementById('qrModal').classList.remove('open');
}

function printQrSticker() {
  window.print();
}

function toggleAnonymousDemo(show) {
  const box = document.getElementById('anonymousDemoBox');
  const btn = document.getElementById('demoToggleBtn');
  if (box) box.style.display = show ? 'block' : 'none';
  if (btn) btn.style.display = show ? 'none' : 'inline-flex';
}

function sendAnonymousNotification() {
  const input = document.getElementById('anonymousMsgInput');
  if (!input || !input.value.trim()) {
    showToast('Please enter a message to notify the owner.', 'error');
    return;
  }
  showToast('Anonymous notification delivered to the owner\'s account! 📲');
  input.value = '';
  toggleAnonymousDemo(false);
}

// ── Register Belonging Modal ──────────────────────────────────────────────
function handleOpenRegisterBelonging() {
  if (!currentUser) {
    document.getElementById('authRequiredModal').classList.add('open');
  } else {
    document.getElementById('registerBelongingModal').classList.add('open');
  }
}

let editingBelongingId = null;

function closeRegisterBelongingModal() {
  document.getElementById('registerBelongingModal').classList.remove('open');
  const form = document.getElementById('registerBelongingForm');
  if (form) form.reset();
  resetCategoryPicker('regCategory');
  editingBelongingId = null;
  document.getElementById('registerModalTitle').textContent = 'Register Valuable Belonging';
  document.getElementById('registerModalSubtitle').textContent = 'Register your laptop, tumbler, or binder before it gets lost to generate an anonymous recovery QR sticker.';
  document.getElementById('regSubmitBtn').textContent = 'Register & Generate QR Sticker';
}

let activeCategoryField = '';

function openCategoryPicker(fieldId) {
  activeCategoryField = fieldId;
  document.getElementById('categoryPickerModal').classList.add('open');
}

function closeCategoryPicker() {
  document.getElementById('categoryPickerModal').classList.remove('open');
  activeCategoryField = '';
}

function selectCategory(value, icon) {
  if (!activeCategoryField) return;
  document.getElementById(activeCategoryField).value = value;
  const picker = document.getElementById(`${activeCategoryField}Picker`);
  picker.innerHTML = `<svg class="category-picker-selected-icon" aria-hidden="true"><use href="#category-icon-${icon}"></use></svg>${value}`;
  picker.classList.add('selected');
  closeCategoryPicker();
}

function resetCategoryPicker(fieldId) {
  const field = document.getElementById(fieldId);
  const picker = document.getElementById(`${fieldId}Picker`);
  if (field) field.value = '';
  if (picker) {
    picker.textContent = 'Select category...';
    picker.classList.remove('selected');
  }
}

function closeAuthRequiredModal() {
  document.getElementById('authRequiredModal').classList.remove('open');
}

function closeBelongingMenus() {
  document.querySelectorAll('.belonging-menu.open').forEach(menu => {
    menu.classList.remove('open');
    menu.parentElement?.classList.remove('menu-open');
    menu.previousElementSibling?.setAttribute('aria-expanded', 'false');
  });
}

function toggleBelongingMenu(event, id) {
  event.stopPropagation();
  const menu = document.getElementById(`belonging-menu-${id}`);
  if (!menu) return;
  const wasOpen = menu.classList.contains('open');
  closeBelongingMenus();
  if (!wasOpen) {
    menu.classList.add('open');
    menu.parentElement?.classList.add('menu-open');
    menu.previousElementSibling?.setAttribute('aria-expanded', 'true');
  }
}

function editRegisteredBelonging(event, id) {
  event.stopPropagation();
  closeBelongingMenus();
  const item = loadedItems.find(entry => String(entry.id) === String(id));
  if (!item) return showToast('Belonging details are unavailable. Please refresh and try again.', true);
  editingBelongingId = item.id;
  document.getElementById('regTitle').value = item.title || '';
  document.getElementById('regCategory').value = item.category || '';
  const categoryPicker = document.getElementById('regCategoryPicker');
  categoryPicker.textContent = item.category || 'Select category...';
  categoryPicker.classList.toggle('selected', Boolean(item.category));
  document.getElementById('regLocation').value = item.location || 'Campus-wide';
  document.getElementById('regIdentifiers').value = item.locationDetails || item.verification || '';
  document.getElementById('regInstructions').value = item.instructions || '';
  document.getElementById('registerModalTitle').textContent = 'Edit Registered Belonging';
  document.getElementById('registerModalSubtitle').textContent = 'Update the details for this registered belonging.';
  document.getElementById('regSubmitBtn').textContent = 'Save Changes';
  document.getElementById('registerBelongingModal').classList.add('open');
}

function deleteRegisteredBelonging(event, id) {
  event.stopPropagation();
  closeBelongingMenus();
  openDeleteModal(id);
}

async function handleRegisterBelongingSubmit(e) {
  e.preventDefault();
  const title        = document.getElementById('regTitle').value.trim();
  const category     = document.getElementById('regCategory').value;
  const location     = document.getElementById('regLocation') ? document.getElementById('regLocation').value : 'Campus-wide';
  const identifiers  = document.getElementById('regIdentifiers').value.trim();
  const instructions = document.getElementById('regInstructions').value.trim();

  if (!title || !category) {
    showToast('Please fill in the item name and category.', 'error');
    return;
  }

  try {
    const isEditing = Boolean(editingBelongingId);
    const res = await fetch(isEditing ? `/api/items/${encodeURIComponent(editingBelongingId)}/registered` : '/api/items/register-belonging', {
      method: isEditing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, category, location, identifiers, instructions })
    });
    const data = await res.json();
    if (!data.success) {
      showToast(data.message || 'Registration failed.', 'error');
      return;
    }

    closeRegisterBelongingModal();
    showToast('✅ Belonging registered! Your QR sticker is ready.');

    if (isEditing) showToast('Belonging details updated.');

    // Open QR sticker modal for the newly registered item
    if (!isEditing) openQrStickerModal(data.item.id);

    // Refresh belonging count chip
    fetchMyBelongingsCount();

    // Refresh feed if currently showing registered items
    if (currentFilter === 'registered') fetchAndRenderItems();

  } catch (err) {
    showToast('Server error. Please try again.', 'error');
  }
}

// ── Anonymous Finder Modal ────────────────────────────────────────────────
function showAnonymousFinderForItem(item, matchToken = '') {
  const safeItem = item || {};
  document.getElementById('finderScreenItemTitle').textContent = safeItem.title || 'Found Item';
  document.getElementById('finderScreenRefCode').textContent = safeItem.refCode || '—';
  const instructions = String(safeItem.instructions || '')
    .replace(/If found, please (notify owner via QR or )?leave with CSPC SASO \/ Campus Security(?: Desk)?\.?/gi, '')
    .trim();
  const instructionsElement = document.getElementById('finderScreenInstructions');
  instructionsElement.textContent = instructions;
  instructionsElement.style.display = instructions ? '' : 'none';
  document.getElementById('finderRefCodeInput').value = safeItem.refCode || '';
  document.getElementById('finderMatchTokenInput').value = matchToken || '';
  document.getElementById('finderSubmissionKeyInput').value =
    window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  document.getElementById('finderMessageInput').value = '';
  document.getElementById('finderLocationInput').value = '';
  document.getElementById('finderContactInput').value = '';
  const form = document.getElementById('anonymousFinderForm');
  form.querySelectorAll('input:not([type="hidden"]), textarea').forEach(field => { field.disabled = false; });
  const sendButton = document.getElementById('finderSendBtn');
  sendButton.disabled = false;
  sendButton.textContent = '🚀 Send Alert to Owner';
  document.getElementById('anonymousFinderModal').classList.add('open');
}

async function openAnonymousFinderModal(refCode) {
  try {
    const res = await fetch(`/api/items/qr-lookup/${encodeURIComponent(refCode)}`);
    const data = await res.json();
    if (!data.success) {
      showToast('Could not load item info. Invalid QR code.', 'error');
      return;
    }
    const item = data.item;
    showAnonymousFinderForItem(item);
  } catch (err) {
    showToast('Failed to load item info.', 'error');
  }
}

function closeAnonymousFinderModal() {
  document.getElementById('anonymousFinderModal').classList.remove('open');
}

async function handleAnonymousFinderSubmit(e) {
  e.preventDefault();
  const refCode       = document.getElementById('finderRefCodeInput').value;
  const matchToken    = document.getElementById('finderMatchTokenInput').value;
  const message       = document.getElementById('finderMessageInput').value.trim();
  const locationFound = document.getElementById('finderLocationInput').value.trim();
  const finderContact = document.getElementById('finderContactInput').value.trim();
  const submissionKey = document.getElementById('finderSubmissionKeyInput').value;
  const sendButton = document.getElementById('finderSendBtn');

  if (sendButton.disabled) return;
  if (!message) {
    showToast('Please describe where and how you found the item.', 'error');
    return;
  }

  sendButton.disabled = true;
  sendButton.textContent = 'Sending Alert...';
  try {
    const endpoint = matchToken ? '/api/items/match-reference-notify' : '/api/items/anonymous-notify';
    const body = matchToken
      ? { token: matchToken, message, locationFound, finderContact }
      : { refCode, message, locationFound, finderContact };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': submissionKey },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Finder alert submitted.');
      loadMyNotifications();
      sendButton.textContent = 'Alert Sent';
      document.getElementById('anonymousFinderForm')
        .querySelectorAll('input:not([type="hidden"]), textarea')
        .forEach(field => { field.disabled = true; });
    } else {
      sendButton.disabled = false;
      sendButton.textContent = '🚀 Send Alert to Owner';
      showToast(data.message || 'Failed to send notification.', 'error');
    }
  } catch (err) {
    sendButton.disabled = false;
    sendButton.textContent = '🚀 Send Alert to Owner';
    showToast('Server error. Please try again.', 'error');
  }
}

// ── Match QR Modal ────────────────────────────────────────────────────────
async function openMatchQrModal(lostId, foundId) {
  try {
    const response = await fetch(`/api/items/match-reference-token?lostId=${encodeURIComponent(lostId)}&foundId=${encodeURIComponent(foundId)}`);
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || 'Could not create match reference.');
    const statusOnly = data.view === 'status-only';
    const lost = data.lost || { title: '—', refCode: '—' };
    const found = data.found || { title: '—', refCode: '—' };
    document.getElementById('matchQrAccessNote').style.display = statusOnly ? 'block' : 'none';
    document.getElementById('matchLostRef').style.display = '';
    document.getElementById('matchFoundRef').style.display = '';
    const printAction = document.querySelector('button[data-action="printMatchQr"]');
    if (printAction) printAction.style.display = statusOnly ? 'none' : '';

    document.getElementById('matchLostTitle').textContent  = lost.title  || '—';
    document.getElementById('matchFoundTitle').textContent = found.title || '—';
    document.getElementById('matchLostRef').textContent    = lost.refCode  || '—';
    document.getElementById('matchFoundRef').textContent   = found.refCode || '—';


    document.getElementById('matchLostLocation').textContent = lost.location || 'Location unavailable';
    document.getElementById('matchFoundLocation').textContent = found.location || 'Location unavailable';

    document.getElementById('matchQrImage').src = qrImageUrl(data.url);

    document.getElementById('matchQrModal').classList.add('open');
  } catch (err) {
    showToast(err.message || 'Could not generate match QR. Please try again.', 'error');
  }
}

function closeMatchQrModal() {
  document.getElementById('matchQrModal').classList.remove('open');
}

function printMatchQr() {
  window.print();
}

async function openMatchReferenceFromQr(token) {
  if (!token) return;
  try {
    const response = await fetch(`/api/items/match-reference/${encodeURIComponent(token)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.success) {
      if (response.status === 401 || response.status === 403) {
        showToast('CSPC Admin sign-in is required to open this verification reference.', 'error');
        return;
      }
      if (response.status === 410) {
        showToast('This QR reference expired. Generate a new QR code.', 'error');
        return;
      }
      throw new Error(data.message || 'This match reference is unavailable.');
    }
    const statusOnly = data.view === 'status-only';
    data.lost = data.lost || { title: '—', refCode: '—' };
    data.found = data.found || { title: '—', refCode: '—' };
    document.getElementById('matchQrAccessNote').style.display = statusOnly ? 'block' : 'none';
    document.getElementById('matchLostRef').style.display = '';
    document.getElementById('matchFoundRef').style.display = '';
    const printAction = document.querySelector('button[data-action="printMatchQr"]');
    if (printAction) printAction.style.display = statusOnly ? 'none' : '';
    document.getElementById('matchLostTitle').textContent = data.lost.title || '—';
    document.getElementById('matchFoundTitle').textContent = data.found.title || '—';
    document.getElementById('matchLostRef').textContent = data.lost.refCode || '—';
    document.getElementById('matchFoundRef').textContent = data.found.refCode || '—';
    document.getElementById('matchLostLocation').textContent = data.lost.location || 'Location unavailable';
    document.getElementById('matchFoundLocation').textContent = data.found.location || 'Location unavailable';
    document.getElementById('matchQrImage').src = qrImageUrl(window.location.href);
    document.getElementById('matchQrModal').classList.remove('open');
    showAnonymousFinderForItem(data.found, token);
  } catch (error) {
    showToast(error.message || 'Could not open match verification.', 'error');
  }
}

// ── Notifications Modal ───────────────────────────────────────────────────
async function openNotificationsModal() {
  document.getElementById('notificationsModal').classList.add('open');
  await loadNotificationsIntoModal();
}

function closeNotificationsModal() {
  document.getElementById('notificationsModal').classList.remove('open');
}

async function loadNotificationsIntoModal() {
  const list = document.getElementById('notificationsList');
  list.innerHTML = '<p class="notif-empty">Loading…</p>';
  try {
    const res = await fetch('/api/items/my-notifications');
    const data = await res.json();
    if (!data.success) {
      document.getElementById('notificationSelectionToolbar').hidden = true;
      list.innerHTML = '<p class="notif-empty">Could not load notifications.</p>';
      return;
    }
    if (!data.notifications.length) {
      document.getElementById('notificationSelectionToolbar').hidden = true;
      list.innerHTML = '<p class="notif-empty">No account notifications yet.</p>';
      return;
    }

    document.getElementById('notificationSelectionToolbar').hidden = false;
    document.getElementById('selectAllNotifications').checked = false;
    list.innerHTML = data.notifications.map(n => `
      <div class="notif-item${n.read ? '' : ' unread'}" data-id="${escapeHtml(String(n.id))}">
        <label class="notification-select-control">
          <input class="notification-select" type="checkbox" value="${escapeHtml(JSON.stringify({
            kind: n.notificationType === 'claim' ? 'claim' : 'item',
            recordId: String(n.notificationType === 'claim' ? n.claimId : n.itemId),
            id: String(n.id)
          }))}" data-change="updateNotificationSelection">
          <span>Select notification</span>
        </label>
        <div class="notif-header">
          <strong>🏷️ ${n.itemTitle || n.refCode}</strong>
          <span class="notif-time">${new Date(n.timestamp).toLocaleString()}</span>
        </div>
        ${n.notificationType === 'match'
          ? `<p class="notif-msg"><strong>Possible match—not confirmed</strong></p>
             <p class="notif-msg">Found item: ${escapeHtml(n.matchItemTitle || n.matchRefCode || 'Found item')} ${n.matchRefCode ? `(${escapeHtml(n.matchRefCode)})` : ''}</p>
             ${n.matchLocation ? `<p class="notif-msg">Reported location: ${escapeHtml(n.matchLocation)}</p>` : ''}
             <p class="notif-msg">${escapeHtml(n.message)}</p>
             <a class="btn-mark-read" style="display:inline-block;text-decoration:none;" href="/?search=${encodeURIComponent(n.matchRefCode || '')}&amp;matchItemId=${encodeURIComponent(n.matchItemId || '')}#items">Review possible match</a>`
          : n.notificationType === 'claim'
            ? `<p class="notif-msg">Claim request update</p><p class="notif-msg">${escapeHtml(n.message)}</p>`
            : `<p class="notif-msg">📍 <em>${escapeHtml(n.locationFound || 'Location not specified')}</em></p>
             <p class="notif-msg">💬 ${escapeHtml(n.message)}</p>
             ${n.finderContact && n.finderContact !== 'Anonymous Student / Finder'
               ? `<p class="notif-contact">📞 Finder left optional contact: ${escapeHtml(n.finderContact)}</p>`
               : '<p class="notif-contact">🔒 Finder remained anonymous</p>'}`}
        ${!n.read ? `<button class="btn-mark-read" data-action="markNotifRead" data-args="${actionArgs(n.id, '$el')}">Mark as read</button>` : ''}
      </div>
    `).join('');
    updateNotificationSelection();

    // Update badge
    const badge = document.getElementById('notifCountBadge');
    if (badge) {
      const unread = data.unreadCount || 0;
      badge.textContent = unread;
      badge.style.display = unread > 0 ? 'inline-flex' : 'none';
    }
  } catch (err) {
    document.getElementById('notificationSelectionToolbar').hidden = true;
    list.innerHTML = '<p class="notif-empty">Failed to load notifications.</p>';
  }
}

function selectAllNotifications(checked) {
  document.querySelectorAll('#notificationsList .notification-select').forEach(input => {
    input.checked = checked;
  });
  updateNotificationSelection();
}

function updateNotificationSelection() {
  const checkboxes = [...document.querySelectorAll('#notificationsList .notification-select')];
  const selectedCount = checkboxes.filter(input => input.checked).length;
  const selectAll = document.getElementById('selectAllNotifications');
  selectAll.checked = checkboxes.length > 0 && selectedCount === checkboxes.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
  document.getElementById('selectedNotificationCount').textContent = `${selectedCount} selected`;
  document.getElementById('deleteSelectedNotifications').disabled = selectedCount === 0;
}

async function deleteSelectedNotifications() {
  const notificationIds = [...document.querySelectorAll('#notificationsList .notification-select:checked')]
    .map(input => JSON.parse(input.value));
  if (!notificationIds.length || !window.confirm(`Delete ${notificationIds.length} selected notification${notificationIds.length === 1 ? '' : 's'}?`)) return;

  const button = document.getElementById('deleteSelectedNotifications');
  button.disabled = true;
  try {
    const res = await fetch('/api/items/notifications', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notificationIds })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Could not delete notifications.');
    showToast(`${data.deletedCount} notification${data.deletedCount === 1 ? '' : 's'} deleted.`);
    await loadNotificationsIntoModal();
    await loadMyNotifications();
  } catch (err) {
    button.disabled = false;
    showToast(err.message || 'Could not delete notifications.', 'error');
  }
}

async function markNotifRead(notifId, btn) {
  try {
    const res = await fetch(`/api/items/notifications/${notifId}/read`, { method: 'PATCH' });
    const data = await res.json();
    if (data.success) {
      const item = btn.closest('.notif-item');
      if (item) item.classList.remove('unread');
      btn.remove();
      await loadMyNotifications(); // refresh badge
    }
  } catch (err) {
    showToast('Could not mark as read.', 'error');
  }
}

async function loadMyNotifications() {
  if (!currentUser) return;
  try {
    const res = await fetch('/api/items/my-notifications');
    if (!res.ok) throw new Error('Notification refresh request failed.');
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Notification refresh failed.');
    const badge = document.getElementById('notifCountBadge');
    if (badge) {
      const unread = data.unreadCount || 0;
      badge.textContent = unread;
      badge.style.display = unread > 0 ? 'inline-flex' : 'none';
    }
  } catch (error) {
    console.error('Could not refresh notification count:', error);
  }
}

function getItemPhotoUrl(item) {
  if (!item || !item.photo) return '';
  if (item.id && /^\/?uploads\//i.test(item.photo)) {
    return `/api/items/${encodeURIComponent(item.id)}/photo`;
  }
  return item.photo;
}

function setItemPhotoState(image, state) {
  const frame = image.closest('.item-photo-frame');
  if (!frame) return;
  frame.dataset.photoState = state;
  if (state === 'error') image.hidden = true;
  const statusText = frame.querySelector('.item-photo-status-text');
  if (statusText && state === 'error') statusText.textContent = 'Photo unavailable';
}

// Image load/error events do not bubble, so listen during the capture phase.
document.addEventListener('load', event => {
  if (event.target.matches?.('img[data-item-photo]')) setItemPhotoState(event.target, 'loaded');
}, true);
document.addEventListener('error', event => {
  if (event.target.matches?.('img[data-item-photo]')) setItemPhotoState(event.target, 'error');
}, true);

function openImageModal(photoSrc, title) {
  if (!photoSrc) return;
  const image = document.getElementById('imageModalImg');
  const fallback = document.getElementById('imageModalFallback');
  image.hidden = false;
  fallback.hidden = true;
  image.onload = () => { image.hidden = false; fallback.hidden = true; };
  image.onerror = () => { image.hidden = true; fallback.hidden = false; };
  image.src = photoSrc;
  document.getElementById('imageModalTitle').innerText = title || 'Item Photo View';
  document.getElementById('imageModal').classList.add('open');
}

function closeImageModal() {
  document.getElementById('imageModal').classList.remove('open');
}

let selectedPhotoFile = null;
let currentPhotoPreviewUrl = '';

function handlePhotoSelect(e) {
  handlePhotoFile(e.target.files[0]);
}

function handlePhotoDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('dragover');
  handlePhotoFile(e.dataTransfer.files[0]);
}

function openPhotoPicker() {
  document.getElementById('itemPhotoInput').click();
}

function setupPhotoDropZone() {
  const area = document.getElementById('photoUploadArea');
  if (!area) return;
  area.addEventListener('dragover', event => {
    event.preventDefault();
    area.classList.add('dragover');
  });
  area.addEventListener('dragleave', () => area.classList.remove('dragover'));
  area.addEventListener('drop', handlePhotoDrop);
}

// The optional fields fold away again whenever the form is cleared (Cancel or after submitting).
function setupReportMoreDetails() {
  const form = document.getElementById('itemForm');
  const more = document.getElementById('reportMoreDetails');
  if (!form || !more) return;
  form.addEventListener('reset', () => { more.open = false; });
}

// On wide screens the report form is sticky beside the items (css/polish.css).
// A form shorter than the window sticks just below the navbar; a taller one gets a
// negative top, so it scrolls until its bottom is visible and then sticks there.
function setupReportPanelSticky() {
  const panel = document.getElementById('report');
  if (!panel) return;
  const gap = 16;
  const update = () => {
    const navbarHeight = document.querySelector('.navbar')?.offsetHeight || 0;
    const top = Math.min(navbarHeight + gap, window.innerHeight - panel.offsetHeight - gap);
    panel.style.setProperty('--report-sticky-top', `${top}px`);
  };
  if ('ResizeObserver' in window) new ResizeObserver(update).observe(panel);
  window.addEventListener('resize', update);
  update();
}

function handlePhotoFile(file) {
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    showToast('Image file size must be 5 MB or smaller.', true);
    removePhoto();
    return;
  }
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
    showToast('Choose a JPEG, PNG, GIF, or WebP image.', true);
    removePhoto();
    return;
  }

  removePhoto();
  selectedPhotoFile = file;
  currentPhotoPreviewUrl = URL.createObjectURL(file);
  document.getElementById('photoPreviewImg').src = currentPhotoPreviewUrl;
  document.getElementById('photoPreviewMeta').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
  document.getElementById('photoPreviewBox').style.display = 'flex';
}

function removePhoto() {
  selectedPhotoFile = null;
  if (currentPhotoPreviewUrl) URL.revokeObjectURL(currentPhotoPreviewUrl);
  currentPhotoPreviewUrl = '';
  const input = document.getElementById('itemPhotoInput');
  if (input) input.value = '';
  document.getElementById('photoPreviewBox').style.display = 'none';
  document.getElementById('photoPreviewImg').src = '';
  document.getElementById('photoPreviewMeta').textContent = '';
}

function resetItemForm() {
  document.getElementById('itemForm').reset();
  rotateReportSubmissionKey();
  removePhoto();
  resetCategoryPicker('itemCategory');
  updateTypeRadio();
}

const reportSubmissionKeyStorage = 'back2you.reportSubmissionKey';
function createReportSubmissionKey() {
  return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function rotateReportSubmissionKey() {
  reportSubmissionKey = createReportSubmissionKey();
  sessionStorage.setItem(reportSubmissionKeyStorage, reportSubmissionKey);
}
let reportSubmissionKey = sessionStorage.getItem(reportSubmissionKeyStorage) || createReportSubmissionKey();
sessionStorage.setItem(reportSubmissionKeyStorage, reportSubmissionKey);
let reportSubmissionInProgress = false;

async function handleFormSubmit(e) {
  e.preventDefault();
  if (reportSubmissionInProgress) return;
  reportSubmissionInProgress = true;
  const submitButton = document.querySelector('#itemForm button[type="submit"]');
  const originalSubmitLabel = submitButton ? submitButton.textContent : '';
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting...';
  }

  const type = document.querySelector('input[name="itemType"]:checked').value;
  const title = document.getElementById('itemTitle').value.trim();
  const category = document.getElementById('itemCategory').value;
  const officeLocation = document.getElementById('itemLocation').value;
  const locationDetails = document.getElementById('itemLocationDetails').value.trim();
  const location = locationDetails ? `${officeLocation} (${locationDetails})` : officeLocation;
  const contact = document.getElementById('itemContact').value.trim();
  const desc = document.getElementById('itemDesc').value.trim();
  const verification = document.getElementById('itemVerification').value.trim();

  const payload = new FormData();
  payload.append('title', title);
  payload.append('category', category);
  payload.append('type', type);
  payload.append('location', location);
  payload.append('locationDetails', locationDetails);
  payload.append('contact', contact);
  payload.append('desc', desc);
  payload.append('verification', verification);
  if (selectedPhotoFile) payload.append('photo', selectedPhotoFile);

  try {
    const res = await fetch('/api/items', {
      method: 'POST',
      headers: { 'Idempotency-Key': reportSubmissionKey },
      body: payload
    });

    const data = await res.json();
    if (data.success) {
      rotateReportSubmissionKey();
      document.getElementById('itemForm').reset();
      removePhoto();
      updateTypeRadio();
      fetchStats();
      fetchAndRenderItems();

      if (false && data.potentialMatch) {
        showToast(`Report saved (${data.item.refCode})! Potential matching ${data.potentialMatch.type} item detected.`);
      } else {
        showToast(`Report saved with Tracking Code: ${data.item.refCode}`);
      }
      openReportSuccessModal(data.item.refCode, data.item.id, data.potentialMatch);
      document.getElementById('items').scrollIntoView({ behavior: 'smooth' });
    } else {
      const message = Array.isArray(data.errors) && data.errors.length
        ? data.errors.join(' ')
        : data.message || 'Validation error';
      showToast(message, true);
    }
  } catch (err) {
    showToast('Network error while saving report.', true);
  } finally {
    reportSubmissionInProgress = false;
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalSubmitLabel;
    }
  }
}

let targetDeleteId = null;
let targetClaimId = null;
let lastCreatedItemId = null;

function openReportSuccessModal(refCode, itemId, potentialMatch) {
  lastCreatedItemId = itemId;
  document.getElementById('successRefCode').innerText = refCode || 'CSPC-LF-2026';
  
  const matchAlert = document.getElementById('successMatchAlert');
  if (false && potentialMatch) {
    matchAlert.style.display = 'block';
    matchAlert.innerHTML = `🎯 <strong>Potential Smart Match Detected!</strong> Matching ${potentialMatch.type} item "${escapeHtml(potentialMatch.title)}" (${escapeHtml(potentialMatch.location)}) found.`;
  } else {
    matchAlert.style.display = 'none';
  }

  document.getElementById('reportSuccessModal').classList.add('open');
}

function closeReportSuccessModal() {
  document.getElementById('reportSuccessModal').classList.remove('open');
}

function openQrFromSuccessModal() {
  closeReportSuccessModal();
  if (lastCreatedItemId) {
    openQrStickerModal(lastCreatedItemId);
  }
}

function openDeleteModal(id) {
  const item = loadedItems.find(i => String(i.id) === String(id));
  targetDeleteId = id;
  const textEl = document.getElementById('deleteConfirmText');
  if (item) {
    textEl.innerText = `Are you sure you want to permanently delete "${item.title}" (${item.refCode || ''}) from campus records?`;
  } else {
    textEl.innerText = `Are you sure you want to permanently delete this report from campus records?`;
  }
  document.getElementById('deleteConfirmModal').classList.add('open');
}

function closeDeleteModal() {
  document.getElementById('deleteConfirmModal').classList.remove('open');
  targetDeleteId = null;
}

async function executeDelete() {
  if (!targetDeleteId) return;
  const id = targetDeleteId;
  closeDeleteModal();

  try {
    const response = await fetch(`/api/items/${id}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || 'Permission denied.');
    fetchStats();
    fetchAndRenderItems();
    showToast('Report permanently removed.');
  } catch (err) {
    showToast(err.message || 'Error removing report.', true);
  }
}

function deleteItem(id) {
  openDeleteModal(id);
}

function openClaimModal(id) {
  const item = loadedItems.find(i => String(i.id) === String(id));
  if (!item) return;
  targetClaimId = id;

  const titleEl = document.getElementById('claimModalTitle');
  const subtitleEl = document.getElementById('claimModalSubtitle');
  const hintBox = document.getElementById('claimVerificationBox');
  const hintText = document.getElementById('claimModalHint');
  const proofGroup = document.getElementById('claimProofGroup');
  const proofInput = document.getElementById('claimProofInput');
  const btnEl = document.getElementById('claimModalBtn');
  const proofLabel = document.querySelector('label[for="claimProofInput"]');

  proofInput.value = '';
  proofLabel.textContent = 'Claimant Proof / Verification Answer';
  proofInput.placeholder = 'Enter proof, ID details, or verification answer...';

  if (item.claimed) {
    titleEl.innerText = 'Restore Item to Active Status';
    subtitleEl.innerText = `Restore "${item.title}" (${item.refCode || ''}) back to active lost/found listings?`;
    hintBox.style.display = 'none';
    proofGroup.style.display = 'none';
    btnEl.innerText = 'Restore Item';
  } else {
    titleEl.innerText = 'Confirm Item Claim';
    subtitleEl.innerText = `Mark "${item.title}" (${item.refCode || ''}) as successfully claimed/returned.`;
    proofGroup.style.display = 'block';
    btnEl.innerText = 'Confirm Claim';

    if (item.verification) {
      hintBox.style.display = 'block';
      hintText.innerText = `"${item.verification}"`;
    } else {
      hintBox.style.display = 'none';
    }
  }

  document.getElementById('claimConfirmModal').classList.add('open');
}

function closeClaimModal() {
  document.getElementById('claimConfirmModal').classList.remove('open');
  document.getElementById('claimantDetailsGroup').style.display = 'none';
  targetClaimId = null;
}

async function executeClaimToggle() {
  if (!targetClaimId) return;
  const id = targetClaimId;
  const proof = document.getElementById('claimProofInput').value.trim();
  closeClaimModal();

  try {
    const response = await fetch(`/api/items/${id}/claim`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proof })
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || 'Unable to update item status.');
    fetchStats();
    fetchAndRenderItems();
    showToast(data.message);
  } catch (error) {
    showToast(error.message || 'Failed to update status.', true);
  }
}

function toggleClaim(id) {
  openClaimModal(id);
}

function cleanFinderInstructions(value) {
  return String(value || '')
    .replace(/\s*If found, please (notify owner via QR or )?leave with CSPC SASO \/ Campus Security(?: Desk)?\.?/gi, '')
    .trim();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

function showToast(msg, isError = false) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', isError ? 'alert' : 'status');
  if (isError) toast.style.borderColor = '#ef4444';
  toast.innerText = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

// Mobile nav toggle
function toggleMobileNav(e) {
  if (e) e.stopPropagation();
  const links = document.getElementById('navLinks');
  const navbar = document.querySelector('.navbar');
  const toggle = document.getElementById('menuToggle');
  if (!links) return;
  const isOpen = links.classList.toggle('open');
  navbar?.classList.toggle('mobile-drawer-active', isOpen);
  toggle?.classList.toggle('open', isOpen);
  toggle?.setAttribute('aria-expanded', String(isOpen));
}

// Theme toggle
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme') || 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  localStorage.setItem('cspc_theme', next);
  updateThemeIcon();
}

function updateThemeIcon() {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.innerHTML = themeToggleIconHtml(theme);
    btn.setAttribute('title', theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode');
    btn.setAttribute('aria-label', theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode');
  });
}

function loadTheme() {
  const saved = localStorage.getItem('cspc_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon();
}

// Initial load
document.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  setupPhotoDropZone();
  setupReportMoreDetails();
  setupReportPanelSticky();
  const matchParams = new URLSearchParams(window.location.search);
  checkAuthSession().then(() => {
    if (matchParams.get('action') === 'register-belonging') {
      window.history.replaceState(window.history.state, '', '/');
      handleOpenRegisterBelonging();
    }
  });
  fetchStats();
  window.setInterval(loadMyNotifications, 30000);
  openMatchReferenceFromQr(matchParams.get('token'));
  const finderRef = window.location.pathname === '/found' ? matchParams.get('ref') : null;
  if (finderRef) openAnonymousFinderModal(finderRef);
  restoreFeedFromUrl();
  fetchAndRenderItems();

  const reportType = new URLSearchParams(window.location.search).get('report');
  if (reportType === 'lost' || reportType === 'found') startReport(reportType);

  // Close mobile menu on outside click or nav link click
  const links = document.getElementById('navLinks');
  const toggle = document.getElementById('menuToggle');
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.belonging-menu-wrap')) closeBelongingMenus();
    if (links && toggle && !links.contains(e.target) && !toggle.contains(e.target)) {
      links.classList.remove('open');
      document.querySelector('.navbar')?.classList.remove('mobile-drawer-active');
      toggle.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
  if (links) {
    links.querySelectorAll('a, button').forEach(el => {
      el.addEventListener('click', () => links.classList.remove('open'));
    });
  }
});

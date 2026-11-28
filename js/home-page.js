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
const FINDER_CONVERSATIONS_STORAGE_KEY = 'back2youFinderConversations';
let accountUnreadNotificationCount = 0;
let lastDisplayedUnreadNotificationCount = null;

function clearStoredAuth() {
  ['adminToken', 'currentUser', 'userRole'].forEach((key) => {
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
  refreshFinderNotificationsButton();
}

function renderAuthenticatedHeader(user) {
  currentUser = user;
  const isAdmin = user.role === 'admin';
  const roleLabel = isAdmin ? 'Administrator' : user.role === 'employee' ? 'Employee' : 'Student';
  const slot = document.getElementById('userNavSlot');
  const mobileLogout = document.getElementById('mobileMenuLogout');
  const chipVault = document.getElementById('chipMyBelongings');
  const displayName = isAdmin ? 'Admin' : user.fullName || 'Account';
  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  if (mobileLogout) mobileLogout.classList.add('visible');
  if (slot) {
    slot.innerHTML = `
      <button type="button" id="notifBellBtn" data-action="openNotificationsModal" class="notif-bell-btn" title="View QR Recovery Alerts">
        <svg class="notif-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 21h4" />
        </svg><span id="notifCountBadge" class="notif-badge" style="display:none;">0</span>
      </button>
      <div class="user-account-wrap" data-role="${roleLabel}">
        <button type="button" class="user-account-trigger" id="userProfileBtn" data-action="toggleUserProfileMenu" aria-haspopup="menu" aria-expanded="false" aria-controls="userProfileMenu" aria-label="Account menu for ${escapeHtml(displayName)}">
          <span class="user-account-avatar" aria-hidden="true">${escapeHtml(initials)}</span>
          <span class="user-account-name">${escapeHtml(displayName)}</span>
          <svg class="user-account-chevron" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <div class="user-account-menu" id="userProfileMenu" role="menu" aria-label="Account" hidden>
          <div class="user-account-menu-head">
            <strong>${escapeHtml(displayName)}</strong>
            <small>${escapeHtml(user.email || '')}</small>
          </div>
          <button type="button" class="user-account-menu-item keyboard-shortcuts-menu-item" role="menuitem" data-action="openKeyboardShortcutsModal">
            Keyboard shortcuts
          </button>
          <button type="button" class="user-account-menu-item" role="menuitem" data-action="openChangePasswordModal">
            <svg class="ico" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3"/><path d="M2 14h4m4-6h4m4 8h4"/></svg>
            Settings
          </button>
          <button type="button" class="user-account-menu-item user-account-menu-item--danger" role="menuitem" data-action="handleLogout">
            <svg class="ico" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 17l5-5-5-5m5 5H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></svg>
            Sign out
          </button>
        </div>
      </div>
    `;
  }
  if (chipVault) chipVault.style.display = 'inline-block';
  refreshFinderNotificationsButton();
}

function toggleUserProfileMenu() {
  const button = document.getElementById('userProfileBtn');
  const menu = document.getElementById('userProfileMenu');
  if (!button || !menu) return;

  const isOpen = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', String(!isOpen));
  menu.hidden = isOpen;
}

function closeUserProfileMenu() {
  const button = document.getElementById('userProfileBtn');
  const menu = document.getElementById('userProfileMenu');
  if (!button || !menu) return;

  button.setAttribute('aria-expanded', 'false');
  menu.hidden = true;
}

document.addEventListener('click', (event) => {
  const accountMenu = document.querySelector('.user-account-wrap');
  if (accountMenu && !accountMenu.contains(event.target)) closeUserProfileMenu();
});

document.addEventListener('keydown', (event) => {
  const button = document.getElementById('userProfileBtn');
  if (event.key !== 'Escape' || !button || button.getAttribute('aria-expanded') !== 'true') return;

  closeUserProfileMenu();
  button.focus();
});

function openKeyboardShortcutsModal() {
  document.getElementById('keyboardShortcutsModal').classList.add('open');
}

function closeKeyboardShortcutsModal() {
  document.getElementById('keyboardShortcutsModal').classList.remove('open');
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (event.defaultPrevented) return;

    document.querySelectorAll('.button-select.open').forEach((control) => closeButtonSelect(control));
    closeBelongingMenus();
    const active = document.activeElement;
    if (active && active.matches('input, textarea, select')) active.blur();
    return;
  }

  const target = event.target instanceof Element ? event.target : null;
  if (target && target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
  if (document.querySelector('.slip-overlay.open, .del-modal-backdrop.open')) return;
  if (event.repeat || event.altKey) return;

  const key = event.key.toLowerCase();
  const hasCommandModifier = event.ctrlKey || event.metaKey;
  if (hasCommandModifier && key !== 'k') return;

  if ((key === '/' && !hasCommandModifier) || (key === 'k' && hasCommandModifier)) {
    event.preventDefault();
    document.getElementById('searchInput').focus();
    return;
  }

  if (/^[1-5]$/.test(key) && !hasCommandModifier) {
    const filters = ['all', 'lost', 'found', 'claimed', 'registered'];
    const tab = document.querySelector(`.filter-chips .chip[data-filter="${filters[Number(key) - 1]}"]`);
    if (tab && tab.getClientRects().length) {
      event.preventDefault();
      tab.click();
    }
    return;
  }

  if (hasCommandModifier) return;

  if (key === 'r') {
    event.preventDefault();
    const report = document.getElementById('report');
    report.scrollIntoView({ behavior: 'smooth', block: 'start' });
    report.focus({ preventScroll: true });
  } else if (key === 'b') {
    event.preventDefault();
    handleOpenRegisterBelonging();
  } else if (key === 'i') {
    event.preventDefault();
    document.getElementById('items').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (key === 'arrowleft' || key === 'arrowright') {
    const buttons = document.querySelectorAll('#itemsPagination .pagination-btn');
    const button = key === 'arrowleft' ? buttons[0] : buttons[buttons.length - 1];
    if (button && !button.disabled) {
      event.preventDefault();
      button.click();
    }
  } else if (key === '?') {
    event.preventDefault();
    openKeyboardShortcutsModal();
  }
});

async function checkAuthSession() {
  // Render the cached session immediately, before the /api/auth/me round-trip, so a
  // returning student's header (Register Belonging, bell, avatar) is already in place
  // on first paint instead of flashing from the static "Sign In" markup to the
  // authenticated one a moment later on every page navigation.
  let cachedUser = null;
  try {
    const stored = JSON.parse(sessionStorage.getItem('currentUser') || 'null');
    if (
      stored &&
      ['admin', 'student', 'employee'].includes(stored.role) &&
      sessionStorage.getItem('userRole') === stored.role
    ) {
      cachedUser = stored;
      renderAuthenticatedHeader(cachedUser);
      if (cachedUser.role !== 'admin') installDashboardBackGuard();
    }
  } catch (storageError) {
    // Ignore unreadable cached state; the live check below still runs.
  }

  try {
    const res = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) throw new Error('Unable to verify the current session.');
    const data = await res.json();

    if (data.authenticated && data.user && ['admin', 'student', 'employee'].includes(data.user.role)) {
      const matchesCache = cachedUser && cachedUser.email === data.user.email && cachedUser.role === data.user.role;
      currentUser = data.user;
      if (currentUser.role !== 'admin') installDashboardBackGuard();
      if (currentUser.role === 'admin' && window.location.pathname === '/') {
        window.location.replace('/admin.html');
        return;
      }
      sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
      sessionStorage.setItem('userRole', currentUser.role);
      // Skip the re-render when the confirmed session matches what the cache already
      // showed above, so the header never visibly changes twice on the same page load.
      if (!matchesCache) renderAuthenticatedHeader(currentUser);
      fetchMyBelongingsCount();
      loadMyNotifications();
      // The initial feed request already used the confirmed cached session when available.
      if (!matchesCache) fetchAndRenderItems({ keepPage: true });

      if (currentUser.role !== 'admin' && !document.getElementById('itemContact').value) {
        document.getElementById('itemContact').value = `${currentUser.fullName} (${currentUser.email})`;
      }
    } else {
      clearStoredAuth();
      renderGuestHeader();
    }
  } catch (err) {
    // Network/API failure: keep whatever the cache above already rendered, if anything -
    // there's nothing more authoritative to fall back to.
  }
}

function openChangePasswordModal() {
  if (!currentUser) return;
  closeUserProfileMenu();
  document.getElementById('changePasswordEmail').textContent = currentUser.email || '';
  document.getElementById('changePasswordError').style.display = 'none';
  // Students and employees can delete their own account; admins are managed on the admin page.
  document.getElementById('deleteAccountSection').hidden = currentUser.role === 'admin';
  document.getElementById('changePasswordModal').classList.add('open');
  updateChangePasswordState();
  refreshMessengerAlertsSection();
  document.getElementById('currentPassword').focus();
}

function closeChangePasswordModal() {
  document.getElementById('changePasswordModal').classList.remove('open');
  document.getElementById('changePasswordForm').reset();
  updateChangePasswordState();
}

// Live feedback for the change-password form: which requirements the new password still
// needs, whether the two new-password fields match, and whether Save should be enabled -
// the same checks middleware/validate.js's passwordStrengthErrors() runs on submission,
// surfaced as the student types instead of only after a failed save.
function updateChangePasswordState() {
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('newPasswordConfirm').value;

  const requirements = {
    length: newPassword.length >= 8,
    uppercase: /[A-Z]/.test(newPassword),
    lowercase: /[a-z]/.test(newPassword),
    number: /[0-9]/.test(newPassword),
    special: /[!@#$%?&*]/.test(newPassword),
  };
  Object.entries(requirements).forEach(([name, satisfied]) => {
    const item = document.querySelector(`#newPasswordRequirements [data-requirement="${name}"]`);
    if (!item) return;
    item.classList.toggle('satisfied', satisfied);
    item.setAttribute('aria-label', `${satisfied ? 'Met' : 'Required'}: ${item.textContent}`);
  });
  const requirementsMet = Object.values(requirements).every(Boolean);

  const matchHint = document.getElementById('passwordMatchHint');
  if (!confirmPassword) {
    matchHint.textContent = '';
    matchHint.className = 'password-match-hint';
  } else if (confirmPassword === newPassword) {
    matchHint.textContent = 'Passwords match.';
    matchHint.className = 'password-match-hint match';
  } else {
    matchHint.textContent = 'Passwords do not match yet.';
    matchHint.className = 'password-match-hint mismatch';
  }

  document.getElementById('changePasswordSubmit').disabled =
    !currentPassword || !requirementsMet || confirmPassword !== newPassword;
}

async function handleChangePassword(event) {
  event.preventDefault();
  const errorBox = document.getElementById('changePasswordError');
  const showChangeError = (message) => {
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
      body: JSON.stringify({ currentPassword: document.getElementById('currentPassword').value, newPassword }),
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

// ── Delete account (students and employees) ───────────────────────────────
function openDeleteAccountModal() {
  if (!currentUser || currentUser.role === 'admin') return;
  closeChangePasswordModal();
  document.getElementById('deleteAccountForm').reset();
  document.getElementById('deleteAccountEmail').textContent = currentUser.email || '';
  document.getElementById('deleteAccountError').style.display = 'none';
  updateDeleteAccountButton();
  document.getElementById('deleteAccountModal').classList.add('open');
  document.getElementById('deleteAccountPassword').focus();
}

function closeDeleteAccountModal() {
  document.getElementById('deleteAccountModal').classList.remove('open');
  document.getElementById('deleteAccountForm').reset();
}

// The red button unlocks only once the password is entered and DELETE is typed.
function updateDeleteAccountButton() {
  const ready =
    document.getElementById('deleteAccountPassword').value.length > 0 &&
    document.getElementById('deleteAccountConfirm').value.trim() === 'DELETE';
  document.getElementById('deleteAccountSubmit').disabled = !ready;
}

async function handleDeleteAccount(event) {
  event.preventDefault();
  const errorBox = document.getElementById('deleteAccountError');
  const button = document.getElementById('deleteAccountSubmit');
  errorBox.style.display = 'none';
  button.disabled = true;
  button.textContent = 'Deleting…';
  try {
    const res = await fetch('/api/auth/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        password: document.getElementById('deleteAccountPassword').value,
        confirm: document.getElementById('deleteAccountConfirm').value.trim(),
      }),
    });
    const data = await res.json();
    if (data.success) {
      clearInterval(window.notificationBadgeTimer);
      clearStoredAuth();
      renderGuestHeader();
      closeDeleteAccountModal();
      document.getElementById('itemContact').value = '';
      if (currentFilter === 'registered') setFilter('all');
      fetchStats();
      fetchAndRenderItems();
      showToast(data.message);
    } else {
      errorBox.textContent = data.message || 'Could not delete the account.';
      errorBox.style.display = 'block';
    }
  } catch (err) {
    errorBox.textContent = 'Network error. Please try again.';
    errorBox.style.display = 'block';
  } finally {
    button.textContent = 'Delete account';
    updateDeleteAccountButton();
  }
}

// ── Messenger alerts (students and employees) ─────────────────────────────
let messengerAlertsLinked = false;

async function refreshMessengerAlertsSection() {
  const section = document.getElementById('messengerAlertsSection');
  if (!section) return;
  if (!currentUser || currentUser.role === 'admin') {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const statusText = document.getElementById('messengerAlertsStatus');
  const button = document.getElementById('messengerAlertsBtn');
  try {
    const res = await fetch('/api/messenger/status', { credentials: 'same-origin' });
    const data = await res.json();
    if (res.status === 503) {
      section.hidden = true;
      return;
    }
    messengerAlertsLinked = Boolean(data.linked);
    statusText.textContent = messengerAlertsLinked
      ? 'QR scan, possible-match, and location-request alerts are being sent to your Messenger.'
      : 'Get QR scan, possible-match, and location-request alerts on Messenger too.';
    button.textContent = messengerAlertsLinked ? 'Disconnect Messenger' : 'Connect Messenger';
  } catch (err) {
    section.hidden = true;
  }
}

async function handleMessengerAlertsClick() {
  const button = document.getElementById('messengerAlertsBtn');
  button.disabled = true;
  try {
    if (messengerAlertsLinked) {
      await fetch('/api/messenger/unlink', { method: 'POST', credentials: 'same-origin' });
      await refreshMessengerAlertsSection();
      showToast('Messenger alerts disconnected.');
    } else {
      const res = await fetch('/api/messenger/link-code', { method: 'POST', credentials: 'same-origin' });
      const data = await res.json();
      if (!data.success) {
        showToast(data.message || 'Could not start Messenger linking.');
        return;
      }
      document.getElementById('messengerLinkCode').textContent = data.code;
      document.getElementById('messengerLinkExpiry').textContent =
        `This code expires in ${data.expiresInMinutes} minutes and can only be used once.`;
      const pageBtn = document.getElementById('messengerLinkPageBtn');
      if (data.pageUrl) {
        pageBtn.href = data.pageUrl;
        pageBtn.style.display = '';
      } else {
        pageBtn.style.display = 'none';
      }
      closeChangePasswordModal();
      document.getElementById('messengerLinkModal').classList.add('open');
    }
  } catch (err) {
    showToast('Network error. Please try again.');
  } finally {
    button.disabled = false;
  }
}

function closeMessengerLinkModal() {
  document.getElementById('messengerLinkModal').classList.remove('open');
  refreshMessengerAlertsSection();
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
  closeUserProfileMenu();
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
      document.getElementById('statLost').innerText = loadedItems.filter((i) => i.type === 'lost').length;
      document.getElementById('statFound').innerText = loadedItems.filter((i) => i.type === 'found').length;
      document.getElementById('statClaimed').innerText = loadedItems.filter(
        (i) => i.claimed || i.status === 'claimed'
      ).length;
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
  if (location && [...locationSelect.options].some((option) => option.value === location)) {
    setSelectValue(locationSelect, location);
    currentLocationFilter = location.toLowerCase();
  }
  pendingScrollItemId = params.get('matchItemId');
  const page = Number.parseInt(params.get('page'), 10);
  pendingStartPage = page > 1 ? page : null;
  updateFilterUi();
}

function sortItems(items) {
  const time = (item) => Date.parse(item.createdAt || item.date || '') || 0;
  const sorted = items.map((item, index) => ({ item, index }));
  sorted.sort((a, b) => {
    if (currentSort === 'title')
      return (
        (a.item.title || '').localeCompare(b.item.title || '', undefined, { sensitivity: 'base' }) || a.index - b.index
      );
    const diff = currentSort === 'oldest' ? time(a.item) - time(b.item) : time(b.item) - time(a.item);
    return diff || a.index - b.index;
  });
  return sorted.map((entry) => entry.item);
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
  return (
    currentFilter !== 'all' ||
    Boolean(currentLocationFilter) ||
    Boolean(document.getElementById('searchInput').value.trim())
  );
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
  openManualReportForm();
  document.getElementById('itemForm').scrollIntoView({ behavior: 'smooth' });
}

function showItemsLoading(grid) {
  grid.setAttribute('aria-busy', 'true');
  if (grid.querySelector('.project-card')) {
    grid.classList.remove('is-loading');
    return;
  }
  grid.innerHTML =
    Array.from(
      { length: 3 },
      () => `
    <div class="project-card skeleton-card" aria-hidden="true">
      <span class="skeleton-line skeleton-line--short"></span>
      <span class="skeleton-line"></span>
      <span class="skeleton-block"></span>
      <span class="skeleton-line"></span>
    </div>`
    ).join('') + '<span class="visually-hidden" role="status">Loading items…</span>';
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

// Scrolls to an already-rendered item card and briefly outlines it, so a match link or
// notification lands the student on the right card instead of just the top of the feed.
function scrollToAndHighlightItem(id) {
  const card = document.getElementById(`item-card-${id}`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.remove('item-card--highlight');
  void card.offsetWidth; // restarts the animation if the same card was just highlighted
  card.classList.add('item-card--highlight');
  setTimeout(() => card.classList.remove('item-card--highlight'), 2200);
}

// Called by the Quick Report Assistant's match card "View" link: makes sure the matched
// item is visible regardless of the current filter/search, then scrolls to and highlights
// its card - rather than just jumping to the top of the listings.
window.openItemDetails = function openItemDetails(id) {
  if (document.getElementById(`item-card-${id}`)) {
    scrollToAndHighlightItem(id);
    return;
  }
  currentFilter = 'all';
  currentLocationFilter = '';
  const search = document.getElementById('searchInput');
  if (search) search.value = '';
  updateFilterUi();
  pendingScrollItemId = id;
  fetchAndRenderItems();
};

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
  // Claimed items are done - keep them out of All/Lost/Found so the campus listing
  // only shows reports still needing attention; they stay visible under Claimed.
  if (['all', 'lost', 'found'].includes(currentFilter)) params.append('status', 'active');
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
      scrollToAndHighlightItem(pendingScrollItemId);
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
          <p style="font-size: 0.875rem; color: var(--text-muted); max-width: 480px; margin: 0 auto 1.25rem; line-height: 1.5;">
            Save your personal belongings here for private record keeping. After registering, reopen or print its QR sticker from your vault whenever you need a replacement.
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
        <p class="feed-empty-text">${
          filtered
            ? 'Nothing matches the current search or filters. Try different words or clear the filters.'
            : 'No items have been reported yet.'
        }</p>
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

  grid.innerHTML = pageItems
    .map((item, itemIndex) => {
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
            🛡️ <strong>Private Belongings Vault:</strong> Reopen or print this item's QR sticker anytime. Scanning it lets a finder contact you without showing your private contact details.
          </div>

          <p class="item-card-description" style="margin-top: 0.25rem;">${escapeHtml(item.desc)}</p>

          <div class="card-meta-line">
            <span><strong>Primary Building:</strong> ${escapeHtml(item.location)}</span>
            <span><strong>Registered:</strong> ${formatTimestamp(item.createdAt || item.date)}</span>
            ${cleanFinderInstructions(item.instructions) ? `<span><strong>Finder Instructions:</strong> ${escapeHtml(cleanFinderInstructions(item.instructions))}</span>` : ''}
          </div>

          <div class="card-actions" style="margin-top: 1rem;">
            <button class="btn-sm btn-outline" data-action="openQrStickerModal" data-args="${actionArgs(item.id)}">View / Print QR</button>
            <button class="btn-sm btn-outline btn-finder-test" data-action="openAnonymousFinderModal" data-args="${actionArgs(item.refCode)}">Test Finder Screen</button>
          </div>
        </div>
      `;
      }

      const isClaimed = isItemClaimed(item);
      let badgeHtml = '';
      if (isClaimed) {
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

      // Admins and the reporter can both remove a report, lost/found/claimed alike -
      // item.canResolve already means "admin or the reporter" (see publicItemView in
      // routes/itemRoutes.js), and the server re-checks the same thing before deleting.
      const canDelete = currentUser?.role === 'admin' || Boolean(item.canResolve);
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
            ${
              item.refCode
                ? !canShowItemQr(item)
                  ? `<span class="ref-code listing-ref listing-ref-code" title="Reference code">${escapeHtml(item.refCode)}</span>`
                  : `<button type="button" class="ref-code listing-ref listing-ref-button" title="Open QR sticker" aria-label="Open QR sticker for ${escapeHtml(item.title)} (${escapeHtml(item.refCode)})" data-action="openQrStickerModal" data-args="${actionArgs(item.id)}"><span class="listing-ref-code">${escapeHtml(item.refCode)}</span><span class="listing-ref-action" aria-hidden="true">QR</span></button>`
                : ''
            }
          </div>
          <h3 class="listing-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h3>
          <p class="listing-category">${escapeHtml(item.category || 'Uncategorized')}</p>
          ${
            item.desc
              ? `
          <p class="listing-desc">${escapeHtml(item.desc)}</p>
          <button type="button" class="listing-more" data-action="toggleItemDescription" data-args='["$el"]' aria-expanded="false" hidden>Show more</button>`
              : ''
          }
          <ul class="listing-facts">
            <li><span class="listing-fact-icon" aria-hidden="true">📍</span><span><span class="visually-hidden">Location: </span>${escapeHtml(item.location || 'Location not given')}</span></li>
            <li><span class="listing-fact-icon" aria-hidden="true">🕐</span><span>${cardTimeHtml(item.createdAt || item.date, 'Reported')}</span></li>
            ${item.claimedAt ? `<li><span class="listing-fact-icon" aria-hidden="true">✅</span><span>${cardTimeHtml(item.claimedAt, 'Claimed')}</span></li>` : ''}
          </ul>
          ${actionsHtml ? `<div class="card-actions listing-actions">${actionsHtml}</div>` : ''}
        </div>
      </article>
    `;
    })
    .join('');
  renderItemsPagination(totalPages);
  updateItemsSummary(
    items.length,
    (currentPage - 1) * itemsPerPage + 1,
    (currentPage - 1) * itemsPerPage + pageItems.length
  );
  updateDescriptionToggles(grid);
}

function isItemClaimed(item) {
  return Boolean(item && (item.claimed || item.status === 'claimed'));
}

function canShowItemQr(item) {
  return Boolean(
    item && (item.type === 'registered' || (['lost', 'found'].includes(item.type) && !isItemClaimed(item)))
  );
}

// Category name → icon symbol defined in index.html (#category-icon-*).
const CATEGORY_ICON_IDS = {
  Electronics: 'electronics',
  'Water Bottles/Tumblers': 'bottle',
  'Clothing & Accessories': 'clothing',
  'Books & Documents': 'books',
  'Bags & Wallets': 'bag',
  Keys: 'key',
  Jewelry: 'jewelry',
  'Sports Equipment': 'sports',
  'School Supplies': 'school',
  'ID / Cards': 'id',
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
  summary.textContent =
    total > itemsPerPage ? `Showing ${start}–${end} of ${total} ${noun}s` : `${total} ${noun}${total === 1 ? '' : 's'}`;
}

// Descriptions are clamped to a few lines; offer "Show more" only where text is cut off.
function updateDescriptionToggles(root) {
  if (!root) return;
  root.querySelectorAll('.listing-desc').forEach((description) => {
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
  document.querySelectorAll('.filter-chips .chip').forEach((chip) => {
    const active = chip.dataset.filter === currentFilter;
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('.hero-stats .stat-box').forEach((stat) => {
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

// Digital QR stickers are available for registered belongings and unclaimed lost/found reports.
async function openQrStickerModal(id) {
  let item = loadedItems.find((i) => String(i.id) === String(id));
  if (!item) {
    try {
      const res = await fetch(`/api/items/${id}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.message || "Could not load this item's QR sticker.", true);
        return;
      }
      item = data.item;
    } catch (error) {
      console.error('Failed to load item QR sticker:', error);
      showToast("Could not load this item's QR sticker. Please try again.", true);
      return;
    }
  }
  if (!item) {
    showToast('This item is no longer available, so its QR sticker cannot be opened.', true);
    return;
  }
  if (!canShowItemQr(item)) {
    showToast('QR stickers are available for registered belongings and unclaimed lost or found reports.', true);
    return;
  }

  try {
    document.getElementById('qrItemTitle').innerText = item.title;
    const refCode = item.refCode || `CSPC-LF-QR-${item.id}`;
    document.getElementById('qrRefCode').innerText = refCode;

    const finderUrl = new URL('/found', window.location.origin);
    finderUrl.searchParams.set('ref', refCode);
    document.getElementById('qrCodeImage').src = qrImageUrl(finderUrl.toString());

    toggleAnonymousDemo(false);
    document.getElementById('qrModal').classList.add('open');
  } catch (error) {
    console.error('Failed to generate item QR sticker:', error);
    showToast("Could not generate this item's QR sticker. Please try again.", true);
  }
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

// ── QR Scanner ──────────────────────────────────────────────────────────
// Desktop shares a screen/window/tab (getDisplayMedia); touch devices go
// straight to the camera instead - not just because a printed sticker isn't
// on the same screen, but because some mobile browsers expose
// getDisplayMedia while the share picker itself doesn't actually work, which
// otherwise fails every time with a confusing "screen share unavailable" error.
let qrScannerStream = null;
let qrScannerRafId = null;
let qrScannerStopped = true;
let qrScannerMode = null; // 'screen' | 'camera'

// Full-viewport spinner while the camera/screen stream is still connecting
// (otherwise the video box is just black and looks stuck or broken).
function setQrScannerConnecting(connecting) {
  const overlay = document.getElementById('qrScannerLoading');
  if (overlay) overlay.hidden = !connecting;
}

// Small spinner next to the status text for the whole time frames are
// actively being decoded, so scanning doesn't look idle once the feed is live.
function setQrScannerBusy(busy) {
  const spinner = document.getElementById('qrScannerStatusSpinner');
  if (spinner) spinner.hidden = !busy;
}

function setQrScannerStatus(text) {
  const textEl = document.getElementById('qrScannerStatusText');
  if (textEl) textEl.textContent = text;
}

async function openQrScanner() {
  const titleEl = document.getElementById('qrScannerTitle');
  const subtitleEl = document.getElementById('qrScannerSubtitle');
  const video = document.getElementById('qrScannerVideo');
  qrScannerStopped = false;
  document.getElementById('qrScannerModal').classList.add('open');
  setQrScannerConnecting(true);
  setQrScannerBusy(false);

  const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
  const canShareScreen = !isTouchDevice && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
  const canUseCamera = typeof navigator.mediaDevices?.getUserMedia === 'function';

  if (typeof jsQR !== 'function' || (!canShareScreen && !canUseCamera)) {
    setQrScannerConnecting(false);
    setQrScannerStatus("This device can't scan QR codes in-app. Open the sticker link directly instead.");
    return;
  }

  qrScannerMode = canShareScreen ? 'screen' : 'camera';
  video.classList.toggle('qr-scanner-video--camera', qrScannerMode === 'camera');
  document.getElementById('qrScannerModal').classList.toggle('qr-scanner-modal--camera', qrScannerMode === 'camera');
  if (titleEl) titleEl.textContent = qrScannerMode === 'screen' ? 'Scan QR From Screen' : 'Scan QR With Camera';
  if (subtitleEl) {
    subtitleEl.textContent =
      qrScannerMode === 'screen' ? 'Share the screen or window showing the QR code.' : 'Point your camera at the sticker.';
  }
  setQrScannerStatus(qrScannerMode === 'screen' ? 'Requesting screen share…' : 'Requesting camera access…');

  let stream;
  try {
    stream =
      qrScannerMode === 'screen'
        ? await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'never' }, audio: false })
        : await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch (error) {
    console.error('Scanner media access failed:', error);
    setQrScannerConnecting(false);
    setQrScannerStatus(
      qrScannerMode === 'screen'
        ? 'Screen share was cancelled or unavailable. Try again and pick the window showing the code.'
        : 'Camera access was denied or unavailable. Allow camera access and try again.'
    );
    return;
  }

  if (qrScannerStopped) {
    // The modal was closed while the permission/share prompt was still open.
    stream.getTracks().forEach((track) => track.stop());
    return;
  }

  qrScannerStream = stream;
  if (qrScannerMode === 'screen') {
    // If the person stops sharing from the browser's own "Stop sharing" control,
    // close the modal instead of looping forever against a dead video track.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (!qrScannerStopped) closeQrScanner();
    });
  }

  video.srcObject = stream;
  await video.play();
  setQrScannerConnecting(false);
  setQrScannerBusy(true);
  setQrScannerStatus(
    qrScannerMode === 'screen' ? 'Move the QR code into view on the shared screen.' : 'Align the QR code in the camera view.'
  );
  scanQrFrame();
}

function scanQrFrame() {
  if (qrScannerStopped) return;
  const video = document.getElementById('qrScannerVideo');
  const canvas = document.getElementById('qrScannerCanvas');

  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
    if (code?.data) {
      handleScannedQrText(code.data);
      return;
    }
  }
  qrScannerRafId = requestAnimationFrame(scanQrFrame);
}

// Scanned text is either the full sticker URL (https://host/found?ref=CODE) or,
// if someone scans a plain printout of the code, the ref code text itself.
function handleScannedQrText(text) {
  let refCode = null;
  try {
    refCode = new URL(text, window.location.origin).searchParams.get('ref');
  } catch {
    // Not a URL: fall through to the raw ref-code check below.
  }
  if (!refCode && /^CSPC-[A-Z0-9-]+$/i.test(text.trim())) {
    refCode = text.trim();
  }

  if (!refCode) {
    setQrScannerStatus("That's not a Back2You code. Keep it in view and try again.");
    qrScannerRafId = requestAnimationFrame(scanQrFrame);
    return;
  }

  closeQrScanner();
  closeQrModal();
  openAnonymousFinderModal(refCode);
}

function triggerQrImageUpload() {
  document.getElementById('qrScannerFileInput')?.click();
}

// Mobile's camera-only equivalent of desktop's screen-share mode: phones have
// no Screen Capture API a web page can use (see openQrScanner above), so a QR
// code shown elsewhere on the same phone has to be scanned from a saved
// screenshot/photo instead.
function handleQrImageSelect(event) {
  const input = event.target;
  const file = input.files?.[0];
  input.value = ''; // let the same file be picked again later
  if (!file) return;

  setQrScannerStatus('Reading image…');
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(objectUrl);
    const canvas = document.getElementById('qrScannerCanvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'attemptBoth' });
    if (code?.data) {
      handleScannedQrText(code.data);
      return;
    }
    setQrScannerStatus("Couldn't find a QR code in that photo. Try another one.");
  };
  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    setQrScannerStatus("Couldn't read that image. Try another one.");
  };
  image.src = objectUrl;
}

function closeQrScanner() {
  qrScannerStopped = true;
  qrScannerMode = null;
  if (qrScannerRafId) cancelAnimationFrame(qrScannerRafId);
  qrScannerRafId = null;
  if (qrScannerStream) {
    qrScannerStream.getTracks().forEach((track) => track.stop());
    qrScannerStream = null;
  }
  const video = document.getElementById('qrScannerVideo');
  if (video) {
    video.srcObject = null;
    video.classList.remove('qr-scanner-video--camera');
  }
  setQrScannerBusy(false);
  setQrScannerConnecting(true);
  const modal = document.getElementById('qrScannerModal');
  modal.classList.remove('open');
  modal.classList.remove('qr-scanner-modal--camera');
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
  showToast("Anonymous notification delivered to the owner's account! 📲");
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
  const moreDetails = document.getElementById('registerMoreDetails');
  if (moreDetails) moreDetails.open = false;
  editingBelongingId = null;
  document.getElementById('registerModalTitle').textContent = 'Register Valuable Belonging';
  document.getElementById('registerModalSubtitle').textContent =
    'Save your laptop, tumbler, or binder in your private belongings vault. Report it as lost or found if you need a QR sticker.';
  document.getElementById('regSubmitBtn').textContent = 'Save Belonging';
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
  document.querySelectorAll('.belonging-menu.open').forEach((menu) => {
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
  const item = loadedItems.find((entry) => String(entry.id) === String(id));
  if (!item) return showToast('Belonging details are unavailable. Please refresh and try again.', true);
  editingBelongingId = item.id;
  document.getElementById('regTitle').value = item.title || '';
  document.getElementById('regCategory').value = item.category || '';
  const categoryPicker = document.getElementById('regCategoryPicker');
  categoryPicker.textContent = item.category || 'Select category...';
  categoryPicker.classList.toggle('selected', Boolean(item.category));
  document.getElementById('regLocation').value = item.location || 'Campus-wide';
  const identifiers = item.locationDetails || item.verification || '';
  const instructions = item.instructions || '';
  document.getElementById('regIdentifiers').value = identifiers;
  document.getElementById('regInstructions').value = instructions;
  const moreDetails = document.getElementById('registerMoreDetails');
  if (moreDetails) moreDetails.open = Boolean(identifiers || instructions);
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

let registerBelongingSubmissionInProgress = false;

async function handleRegisterBelongingSubmit(e) {
  e.preventDefault();
  if (registerBelongingSubmissionInProgress) return;

  const title = document.getElementById('regTitle').value.trim();
  const category = document.getElementById('regCategory').value;
  const location = document.getElementById('regLocation')
    ? document.getElementById('regLocation').value
    : 'Campus-wide';
  const identifiers = document.getElementById('regIdentifiers').value.trim();
  const instructions = document.getElementById('regInstructions').value.trim();

  if (!title || !category) {
    showToast('Please fill in the item name and category.', 'error');
    return;
  }

  const isEditing = Boolean(editingBelongingId);
  const submitButton = document.getElementById('regSubmitBtn');
  const originalLabel = submitButton ? submitButton.textContent : '';
  registerBelongingSubmissionInProgress = true;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = isEditing ? 'Saving Changes…' : 'Saving…';
  }

  let succeeded = false;
  try {
    const res = await fetch(
      isEditing ? `/api/items/${encodeURIComponent(editingBelongingId)}/registered` : '/api/items/register-belonging',
      {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, category, location, identifiers, instructions }),
      }
    );
    const data = await res.json();
    if (!data.success) {
      showToast(data.message || 'Registration failed.', 'error');
      return;
    }

    succeeded = true;
    closeRegisterBelongingModal();
    showToast(isEditing ? 'Belonging details updated.' : 'Belonging saved in your private vault.');

    // Refresh belonging count chip
    fetchMyBelongingsCount();

    // Refresh feed if currently showing registered items
    if (currentFilter === 'registered') fetchAndRenderItems();
  } catch (err) {
    showToast('Server error. Please try again.', 'error');
  } finally {
    registerBelongingSubmissionInProgress = false;
    if (submitButton) {
      submitButton.disabled = false;
      // A successful submit already closed the modal and reset the label via
      // closeRegisterBelongingModal(); only restore it here on failure.
      if (!succeeded) submitButton.textContent = originalLabel;
    }
  }
}

// ── Anonymous Finder Modal ────────────────────────────────────────────────
let activeFinderConversationToken = null;
let activeRegisteredFinderConversation = null;

function getSavedFinderConversations() {
  let serialized;
  try {
    serialized = localStorage.getItem(FINDER_CONVERSATIONS_STORAGE_KEY);
  } catch (error) {
    console.error('Could not access saved finder conversations:', error);
    return [];
  }
  if (!serialized) return [];

  try {
    const saved = JSON.parse(serialized);
    if (!Array.isArray(saved)) throw new Error('Saved finder conversations must be a list.');
    return saved.filter(
      (entry) =>
        entry &&
        typeof entry.id === 'string' &&
        /^notif-[a-z0-9-]+$/i.test(entry.id) &&
        typeof entry.token === 'string' &&
        /^[a-f0-9]{64}$/i.test(entry.token)
    );
  } catch (error) {
    console.error('Saved finder conversations could not be read:', error);
    return [];
  }
}

function refreshFinderNotificationsButton() {
  const slot = document.getElementById('userNavSlot');
  if (!slot) return;
  const savedCount = getSavedFinderConversations().length;

  if (currentUser) {
    const badge = document.getElementById('notifCountBadge');
    const count = accountUnreadNotificationCount + savedCount;
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'inline-flex' : 'none';
    }
    return;
  }

  const existing = document.getElementById('finderNotificationsBtn');
  if (!savedCount) {
    existing?.remove();
    return;
  }
  if (existing) {
    const badge = existing.querySelector('.notif-badge');
    if (badge) badge.textContent = savedCount;
    return;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'finderNotificationsBtn';
  button.className = 'notif-bell-btn';
  button.dataset.action = 'openNotificationsModal';
  button.title = 'View saved finder conversations';
  button.setAttribute('aria-label', `View ${savedCount} saved finder conversation${savedCount === 1 ? '' : 's'}`);
  button.innerHTML = `<span class="notif-icon" aria-hidden="true">🔔</span><span class="notif-badge">${savedCount}</span>`;
  slot.prepend(button);
}

function saveFinderConversation(conversation) {
  const savedConversations = getSavedFinderConversations();
  const existing = savedConversations.find((entry) => entry.id === conversation.id);
  const saved = savedConversations.filter((entry) => entry.id !== conversation.id);
  saved.unshift({
    id: conversation.id,
    token: conversation.token,
    itemTitle: conversation.itemTitle || '',
    expiresAt: conversation.expiresAt || '',
    savedAt: existing?.savedAt || new Date().toISOString(),
  });
  try {
    localStorage.setItem(FINDER_CONVERSATIONS_STORAGE_KEY, JSON.stringify(saved));
  } catch (error) {
    console.error('Could not save finder conversation on this device:', error);
    showToast(
      'Conversation started, but this browser could not save access for later. Copy the secure link to keep it.',
      true
    );
    return false;
  }
  refreshFinderNotificationsButton();
  return true;
}

function removeSavedFinderConversation(conversationId) {
  const saved = getSavedFinderConversations().filter((entry) => entry.id !== conversationId);
  try {
    localStorage.setItem(FINDER_CONVERSATIONS_STORAGE_KEY, JSON.stringify(saved));
  } catch (error) {
    console.error('Could not remove saved finder conversation:', error);
    showToast('Could not remove this saved conversation from the browser.', true);
    return false;
  }
  refreshFinderNotificationsButton();
  return true;
}

async function loadSavedFinderConversationNotifications() {
  const savedConversations = getSavedFinderConversations();
  return Promise.all(
    savedConversations.map(async (saved) => {
      const base = {
        notificationType: 'guest-finder-conversation',
        id: saved.id,
        conversationId: saved.id,
        itemTitle: saved.itemTitle || 'QR finder conversation',
        timestamp: saved.savedAt || new Date().toISOString(),
        conversationExpiresAt: saved.expiresAt,
        conversationStatus: 'open',
        lastMessage: '',
      };
      if (saved.expiresAt && Date.parse(saved.expiresAt) <= Date.now()) {
        return { ...base, conversationStatus: 'expired' };
      }

      try {
        const response = await fetch(`/api/items/registered-conversations/${encodeURIComponent(saved.id)}/guest`, {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${saved.token}` },
        });
        if (response.status === 410) return { ...base, conversationStatus: 'expired' };
        if (!response.ok) throw new Error(`Could not refresh saved finder conversation (${response.status}).`);
        const data = await response.json();
        if (!data.success) throw new Error(data.message || 'Could not refresh saved finder conversation.');
        saveFinderConversation({
          id: saved.id,
          token: saved.token,
          itemTitle: data.item?.title || saved.itemTitle,
          expiresAt: data.conversation?.expiresAt || saved.expiresAt,
        });
        return {
          ...base,
          itemTitle: data.item?.title || base.itemTitle,
          conversationExpiresAt: data.conversation?.expiresAt || saved.expiresAt,
          conversationStatus: data.conversation?.status || 'open',
          lastMessage: data.messages?.at(-1)?.text || '',
        };
      } catch (error) {
        console.error(`Could not refresh finder conversation ${saved.id}:`, error);
        return { ...base, loadError: true };
      }
    })
  );
}

function createFinderConversationToken() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function setFinderConversationLink(conversationId, token) {
  const fragment = `finderConversation=${encodeURIComponent(conversationId)}.${token}`;
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}#${fragment}`
  );
}

function getFinderConversationLink() {
  const match = window.location.hash.match(/^#finderConversation=([^.]*)\.([a-f0-9]{64})$/i);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[1]);
    return /^notif-[a-z0-9-]+$/i.test(id) ? { id, token: match[2] } : null;
  } catch (error) {
    return null;
  }
}

async function copyFinderConversationLink() {
  const credentials = getFinderConversationLink();
  if (!credentials) {
    showToast('The secure conversation link is not available.', true);
    return;
  }
  try {
    await navigator.clipboard.writeText(window.location.href);
    showToast('Secure conversation link copied. It expires in seven days.');
  } catch (error) {
    showToast('Could not copy the link. Copy it from your browser address bar instead.', true);
  }
}

function openFinderConversationFromModal() {
  const credentials = getFinderConversationLink();
  if (!credentials) {
    showToast('The secure conversation link is not available.', true);
    return;
  }
  openRegisteredFinderConversation(credentials.id, credentials.token);
}

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
  document.getElementById('finderShareContactToggle').checked = false;
  document.getElementById('finderContactField').hidden = true;
  const form = document.getElementById('anonymousFinderForm');
  form.querySelectorAll('input:not([type="hidden"]), textarea').forEach((field) => {
    field.disabled = false;
  });
  const sendButton = document.getElementById('finderSendBtn');
  sendButton.disabled = false;
  sendButton.textContent = '🚀 Send to Owner';
  const isRegisteredBelonging = safeItem.isRegisteredBelonging === true && !matchToken;
  activeFinderConversationToken = isRegisteredBelonging ? createFinderConversationToken() : null;
  const copyConversationButton = document.getElementById('finderCopyConversationLinkBtn');
  copyConversationButton.hidden = true;
  copyConversationButton.disabled = true;
  const openConversationButton = document.getElementById('finderOpenConversationBtn');
  openConversationButton.hidden = true;
  openConversationButton.disabled = true;
  document.getElementById('anonymousFinderModal').classList.add('open');
}

// Reveals the contact field only once the finder opts in to sharing it.
function toggleFinderContactField(checked) {
  const field = document.getElementById('finderContactField');
  field.hidden = !checked;
  if (!checked) document.getElementById('finderContactInput').value = '';
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
    if (item.isOwnReport) {
      document.getElementById('ownReportScanModal').classList.add('open');
      return;
    }
    showAnonymousFinderForItem(item);
  } catch (err) {
    showToast('Failed to load item info.', 'error');
  }
}

function closeOwnReportScanModal() {
  document.getElementById('ownReportScanModal').classList.remove('open');
}

function closeAnonymousFinderModal() {
  document.getElementById('anonymousFinderModal').classList.remove('open');
}

async function handleAnonymousFinderSubmit(e) {
  e.preventDefault();
  const refCode = document.getElementById('finderRefCodeInput').value;
  const matchToken = document.getElementById('finderMatchTokenInput').value;
  const message = document.getElementById('finderMessageInput').value.trim();
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
      : {
          refCode,
          message,
          locationFound,
          finderContact,
          ...(activeFinderConversationToken ? { conversationToken: activeFinderConversationToken } : {}),
        };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': submissionKey },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Finder alert submitted.');
      loadMyNotifications();
      sendButton.textContent = 'Alert Sent';
      document
        .getElementById('anonymousFinderForm')
        .querySelectorAll('input:not([type="hidden"]), textarea')
        .forEach((field) => {
          field.disabled = true;
        });
      if (data.conversation?.id && data.conversation?.token) {
        saveFinderConversation({
          id: data.conversation.id,
          token: data.conversation.token,
          itemTitle: data.itemTitle || refCode,
          expiresAt: data.conversation.expiresAt,
        });
        setFinderConversationLink(data.conversation.id, data.conversation.token);
        const copyConversationButton = document.getElementById('finderCopyConversationLinkBtn');
        copyConversationButton.disabled = false;
        copyConversationButton.hidden = false;
        const openConversationButton = document.getElementById('finderOpenConversationBtn');
        openConversationButton.disabled = false;
        openConversationButton.hidden = false;
      }
    } else {
      sendButton.disabled = false;
      sendButton.textContent = '🚀 Send to Owner';
      showToast(data.message || 'Failed to send notification.', 'error');
    }
  } catch (err) {
    sendButton.disabled = false;
    sendButton.textContent = '🚀 Send to Owner';
    showToast('Server error. Please try again.', 'error');
  }
}

// ── Match QR Modal ────────────────────────────────────────────────────────
// The button never reveals the other party's identity up front - it opens
// straight into the claim conversation, matching the privacy the status-only API
// response already enforces (it strips location/contact for anyone but an admin
// or a party to the match). The other person only becomes visible once a claim
// exists and the two of them are messaging directly. Either side can start the
// conversation, and the button names the other participant based on the viewer's role.
function updateMatchConversationButton(canRequestClaim, lostId, foundId, claimId, foundTitle, requesterRole) {
  const button = document.getElementById('matchConversationBtn');
  if (!button) return;
  const label =
    requesterRole === 'owner' ? '💬 Message the finder' : requesterRole === 'finder' ? '💬 Message the owner' : '';
  button.style.display = canRequestClaim && label ? '' : 'none';
  button.dataset.lostId = lostId || '';
  button.dataset.foundId = foundId || '';
  button.dataset.claimId = claimId || '';
  button.dataset.foundTitle = foundTitle || '';
  button.dataset.role = requesterRole || '';
  if (label) button.textContent = label;
}

async function openMatchQrModal(lostId, foundId) {
  try {
    const response = await fetch(
      `/api/items/match-reference-token?lostId=${encodeURIComponent(lostId)}&foundId=${encodeURIComponent(foundId)}`
    );
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
    updateMatchConversationButton(
      data.canRequestClaim,
      lost.id,
      found.id,
      data.claimId,
      found.title,
      data.requesterRole
    );

    document.getElementById('matchLostTitle').textContent = lost.title || '—';
    document.getElementById('matchFoundTitle').textContent = found.title || '—';
    document.getElementById('matchLostRef').textContent = lost.refCode || '—';
    document.getElementById('matchFoundRef').textContent = found.refCode || '—';

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

// ── Open the claim conversation straight from the Match QR modal ───────────
function openClaimThreadModalFromMatch() {
  const button = document.getElementById('matchConversationBtn');
  closeMatchQrModal();
  if (button.dataset.claimId) {
    openClaimThreadModal(button.dataset.claimId);
  } else {
    openClaimThreadStarter(
      button.dataset.lostId,
      button.dataset.foundId,
      button.dataset.foundTitle,
      button.dataset.role
    );
  }
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
    updateMatchConversationButton(
      data.canRequestClaim,
      data.lost.id,
      data.found.id,
      data.claimId,
      data.found.title,
      data.requesterRole
    );
    document.getElementById('matchQrModal').classList.add('open');
  } catch (error) {
    showToast(error.message || 'Could not open match verification.', 'error');
  }
}

// ── Notifications Modal ───────────────────────────────────────────────────
let notificationsRefreshTimer = null;
let notificationsLoadRequestId = 0;
let notificationsRefreshInProgress = false;

async function openNotificationsModal() {
  const heading = document.getElementById('notificationsHeading');
  const subtitle = document.getElementById('notificationsSubtitle');
  if (heading) heading.textContent = currentUser ? 'Account Notifications' : 'Finder Notifications';
  if (subtitle)
    subtitle.textContent = currentUser
      ? 'Account alerts and QR finder conversations saved on this browser'
      : 'Your QR finder conversations are saved on this browser';
  const modal = document.getElementById('notificationsModal');
  const list = document.getElementById('notificationsList');
  modal.classList.add('open');
  clearInterval(notificationsRefreshTimer);
  await loadNotificationsIntoModal({ silent: list.dataset.loaded === 'true' });
  if (!modal.classList.contains('open')) return;
  // While the inbox is open, pick up the other person's reply to a location request.
  notificationsRefreshTimer = setInterval(refreshOpenNotifications, 20000);
}

function closeNotificationsModal() {
  clearInterval(notificationsRefreshTimer);
  notificationsLoadRequestId++;
  document.getElementById('notificationsModal').classList.remove('open');
}

function refreshOpenNotifications() {
  const list = document.getElementById('notificationsList');
  if (!document.getElementById('notificationsModal').classList.contains('open')) {
    clearInterval(notificationsRefreshTimer);
    return;
  }
  // Never wipe a note being typed, a pending action or a selection in progress.
  const busy =
    [...list.querySelectorAll('.meetup-note')].some((input) => input.value || input === document.activeElement) ||
    list.querySelector('button:disabled[data-busy]') ||
    list.querySelector('.notification-select:checked');
  if (
    !busy &&
    list.querySelector(
      '.notif-item--meetup, .notif-item--claim-conversation, .notif-item--finder-conversation, .notif-item--guest-finder-conversation'
    )
  ) {
    if (notificationsRefreshInProgress) return;
    notificationsRefreshInProgress = true;
    loadNotificationsIntoModal({ silent: true }).finally(() => {
      notificationsRefreshInProgress = false;
    });
  }
}

// ── Handover meetup: one-time location sharing on an approved claim ────────
const MEETUP_MAP_ZOOM = 17;

function meetupTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function meetupNotificationHtml(n, idPrefix = '', mapExpanded = false, notificationCard = false) {
  const other = escapeHtml(n.otherName);
  const otherRole = n.role === 'owner' ? 'the finder' : 'the owner';
  const claimArg = actionArgs(n.claimId, '$el');
  const notificationActionsPrimary = [];
  const notificationActionsSecondary = [];
  const askButton = (label) => {
    const button = `<button type="button" class="btn ${notificationCard ? 'btn-primary' : 'btn-outline'} btn-compact meetup-btn" data-action="requestMeetupLocation" data-args="${claimArg}">${label}</button>`;
    if (notificationCard) {
      notificationActionsPrimary.push(button);
      return '';
    }
    return button;
  };

  // Their location (what I asked for).
  const theirs = n.theirLocation || {};
  let theirsHtml;
  if (theirs.status === 'shared' && theirs.location) {
    // The notifications dropdown lists several of these at once - a live, embedded
    // map per entry was heavy and cramped there. Keep the full map for the claim
    // conversation (idPrefix 'thread-', already behind its own Show Map toggle) and
    // give the notifications list a compact summary with a link to view it there.
    theirsHtml =
      idPrefix === 'thread-'
        ? meetupMapHtml(theirs.location, n.otherName, n.claimId, idPrefix, mapExpanded)
        : meetupSharedSummaryHtml(theirs.location, n.otherName, n.claimId, !notificationCard);
    if (notificationCard && idPrefix !== 'thread-') {
      notificationActionsPrimary.push(
        `<button type="button" class="btn btn-primary btn-compact meetup-btn" data-action="openClaimThreadModal" data-args="${actionArgs(n.claimId)}">View in conversation</button>`
      );
    }
  } else if (theirs.status === 'pending') {
    theirsHtml = `<p class="meetup-status"><span class="meetup-waiting" aria-hidden="true"></span>Waiting for ${other} to share their location…</p>`;
  } else if (theirs.status === 'declined') {
    const canAsk = !theirs.askAgainAt || Date.now() >= Date.parse(theirs.askAgainAt);
    theirsHtml = `<p class="meetup-status">${other} declined to share their location.</p>
      ${canAsk ? askButton('Ask again') : `<p class="meetup-hint">You can ask again after ${meetupTime(theirs.askAgainAt)}.</p>`}`;
  } else {
    const reason =
      theirs.status === 'expired'
        ? `${other}'s shared location has expired. `
        : theirs.status === 'stopped'
          ? `${other} stopped sharing their location. `
          : '';
    theirsHtml = `<p class="meetup-status">${reason}Ask ${other} where to meet.</p>${askButton(`Ask ${other} for their location`)}`;
  }

  // My location (what they asked me for).
  const mine = n.myLocation || {};
  let mineHtml = '';
  if (mine.status === 'pending') {
    if (notificationCard) {
      notificationActionsPrimary.push(
        `<button type="button" class="btn btn-primary btn-compact meetup-btn" data-action="shareMeetupLocation" data-args="${claimArg}">Share my current location</button>`
      );
      notificationActionsSecondary.push(
        `<button type="button" class="btn btn-outline btn-compact meetup-btn" data-action="declineMeetupLocation" data-args="${claimArg}">Decline</button>`
      );
    }
    mineHtml = `
      <div class="meetup-incoming">
        <p class="meetup-incoming-title"><strong>${other} is asking for your location</strong> to meet you for the handover.</p>
        <input type="text" class="meetup-note" maxlength="160" aria-label="Optional note for ${other}" placeholder="Optional note, e.g. I'm at the library entrance" />
        ${
          notificationCard
            ? ''
            : `<div class="meetup-actions">
                <button type="button" class="btn btn-primary btn-compact meetup-btn" data-action="shareMeetupLocation" data-args="${claimArg}">Share my current location</button>
                <button type="button" class="btn btn-outline btn-compact meetup-btn" data-action="declineMeetupLocation" data-args="${claimArg}">Decline</button>
              </div>`
        }
        <p class="meetup-hint">Your location updates live while you're sharing, is shown only to ${other}, and stops the moment you tap Stop sharing (or after an hour of no updates).</p>
      </div>`;
  } else if (mine.status === 'shared' && mine.expiresAt) {
    if (notificationCard) {
      notificationActionsPrimary.push(
        `<button type="button" class="btn btn-primary btn-compact meetup-btn" data-action="stopMeetupLocation" data-args="${claimArg}">Stop sharing</button>`
      );
    }
    mineHtml = `
      <div class="meetup-sharing">
        <p class="meetup-status"><span class="meetup-live" aria-hidden="true"></span>You are live-sharing your location with ${other}, updating as you move.</p>
        <p class="meetup-hint">Keeps updating until ${meetupTime(mine.expiresAt)} unless you stop sharing sooner.</p>
        ${
          notificationCard
            ? ''
            : `<button type="button" class="btn btn-outline btn-compact meetup-btn" data-action="stopMeetupLocation" data-args="${claimArg}">Stop sharing</button>`
        }
      </div>`;
  }

  const intro =
    n.role === 'owner'
      ? `Once you both agree the item matches, arrange where to meet ${otherRole}, ${other}.`
      : `${other} has a claim open on the item you found. Once you both agree it matches, arrange where to meet ${otherRole}, ${other}.`;
  if (notificationCard) {
    const actions = notificationActionsPrimary.length || notificationActionsSecondary.length
      ? `<div class="notif-actions">
           <div class="notif-actions-primary">${notificationActionsPrimary.join('')}</div>
           <div class="notif-actions-secondary">${notificationActionsSecondary.join('')}</div>
         </div>`
      : '';
    return `
      <div class="notif-body">
        <div class="notif-summary">
          <span class="notif-badge notif-badge--alert">Handover meetup</span>
          <p class="notif-msg">${intro}</p>
        </div>
        ${mineHtml}
        <div class="meetup-section">
          <p class="meetup-label">${other}'s location</p>
          ${theirsHtml}
        </div>
      </div>
      ${actions}`;
  }
  return `
    <p class="notif-msg"><strong>Handover meetup</strong> · ${intro}</p>
    ${mineHtml}
    <div class="meetup-section">
      <p class="meetup-label">${other}'s location</p>
      ${theirsHtml}
    </div>`;
}

// Notifications-list stand-in for meetupMapHtml below: no embedded map, just the
// facts plus a button into the claim conversation, where the real map lives.
function meetupSharedSummaryHtml(location, otherName, claimId, includeAction = true) {
  const name = escapeHtml(otherName);
  return `
    <p class="meetup-status"><span class="meetup-live" aria-hidden="true"></span>${name} shared their location · accurate to about ${escapeHtml(String(location.accuracy))} m · visible until ${meetupTime(location.expiresAt)}</p>
    ${
      includeAction
        ? `<div class="meetup-actions">
            <button type="button" class="btn btn-primary btn-compact meetup-btn" data-action="openClaimThreadModal" data-args="${actionArgs(claimId)}">View in conversation</button>
          </div>`
        : ''
    }`;
}

// A live, pannable/zoomable OpenStreetMap (via Leaflet) centred on the shared point,
// with the reading's accuracy as a circle and links to open it in a full map app.
// The map itself is only a placeholder div here - initMeetupMaps() below turns every
// one of these into an actual Leaflet instance once the markup is in the DOM.
function meetupMapHtml(location, otherName, claimId, idPrefix = '', mapExpanded = false) {
  const lat = location.latitude.toFixed(6);
  const lng = location.longitude.toFixed(6);
  const name = escapeHtml(otherName);
  const containerId = `meetup-map-${idPrefix}${escapeHtml(String(claimId)).replace(/[^\w-]/g, '')}`;
  const mapContent = `
    <div class="meetup-map" id="${containerId}" aria-label="Map showing where ${name} is"
      data-meetup-map data-lat="${lat}" data-lng="${lng}" data-accuracy="${escapeHtml(String(location.accuracy))}"></div>
    ${location.note ? `<p class="meetup-note-text">“${escapeHtml(location.note)}”</p>` : ''}
    <p class="meetup-hint">Shared ${escapeHtml(relativeTimeLabel(new Date(location.sharedAt)))} · accurate to about ${escapeHtml(String(location.accuracy))} m · visible until ${meetupTime(location.expiresAt)}</p>
    <div class="meetup-actions">
      <a class="btn btn-primary btn-compact meetup-btn" href="https://www.google.com/maps/search/?api=1&amp;query=${lat},${lng}" target="_blank" rel="noopener">Open in Google Maps</a>
      <a class="btn btn-outline btn-compact meetup-btn" href="https://www.openstreetmap.org/?mlat=${lat}&amp;mlon=${lng}#map=18/${lat}/${lng}" target="_blank" rel="noopener">OpenStreetMap</a>
    </div>`;
  if (idPrefix !== 'thread-') return mapContent;

  const panelId = `${containerId}-panel`;
  return `
    <div class="meetup-map-disclosure">
      <button type="button" class="btn btn-outline btn-compact meetup-btn meetup-map-toggle" aria-expanded="${mapExpanded}" aria-controls="${panelId}">
        ${mapExpanded ? 'Hide Map' : 'Show Map'}
      </button>
      <div class="meetup-map-panel" id="${panelId}"${mapExpanded ? '' : ' hidden'}>${mapContent}</div>
    </div>`;
}

// Tracks live Leaflet instances (keyed by container id) so a notifications refresh can
// tear them down before their containers are replaced - Leaflet leaves listeners behind
// otherwise, and refuses to reinitialize a container id it still remembers.
const activeMeetupMaps = new Map();
// The marker/circle each map is showing, keyed the same way, so a live-tracking update
// can glide the pin to its new spot (updateMeetupMapInPlace) instead of the whole map
// being torn down and rebuilt from scratch.
const activeMeetupMarkers = new Map();
const activeMeetupCircles = new Map();

function destroyMeetupMaps() {
  activeMeetupMaps.forEach((map) => map.remove());
  activeMeetupMaps.clear();
  activeMeetupMarkers.clear();
  activeMeetupCircles.clear();
}

// Destroys only the live maps whose container is inside `root` - used where the rest
// of that root's markup is about to be replaced or discarded too (a fresh thread
// open, or a re-render that isn't a plain movement update).
function destroyMeetupMapsWithin(root) {
  root.querySelectorAll('[data-meetup-map]').forEach((container) => {
    const map = activeMeetupMaps.get(container.id);
    if (map) {
      map.remove();
      activeMeetupMaps.delete(container.id);
      activeMeetupMarkers.delete(container.id);
      activeMeetupCircles.delete(container.id);
    }
  });
}

// Keeps each live meetup map's last camera view across refreshes (the thread polls
// every 5s and rebuilds this box's markup each time, which otherwise recreates the
// map from scratch) - so as the pin moves, it doesn't keep snapping the viewer's own
// pan/zoom back to a default view centred on the latest point.
const meetupMapViewState = new Map();

function initMeetupMaps(root = document.getElementById('notificationsList')) {
  if (typeof L === 'undefined' || !root) return;
  root.querySelectorAll('[data-meetup-map]').forEach((container) => {
    const lat = Number(container.dataset.lat);
    const lng = Number(container.dataset.lng);
    const accuracy = Number(container.dataset.accuracy);
    const savedView = meetupMapViewState.get(container.id);
    const map = L.map(container, { attributionControl: false }).setView(
      savedView ? savedView.center : [lat, lng],
      savedView ? savedView.zoom : MEETUP_MAP_ZOOM
    );
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map);
    const circle = L.circle([lat, lng], {
      radius: accuracy,
      color: '#2563eb',
      weight: 2,
      fillColor: '#3b82f6',
      fillOpacity: 0.16,
    }).addTo(map);
    const marker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'meetup-pin-wrap',
        html: '<span class="meetup-pin" aria-hidden="true"></span>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
    }).addTo(map);
    map.on('moveend zoomend', () => {
      meetupMapViewState.set(container.id, { center: map.getCenter(), zoom: map.getZoom() });
    });

    const attribution = document.createElement('a');
    attribution.className = 'meetup-attribution';
    attribution.href = 'https://www.openstreetmap.org/copyright';
    attribution.target = '_blank';
    attribution.rel = 'noopener';
    attribution.textContent = '© OpenStreetMap';
    container.appendChild(attribution);

    activeMeetupMaps.set(container.id, map);
    activeMeetupMarkers.set(container.id, marker);
    activeMeetupCircles.set(container.id, circle);
  });
}

// Resolves a claim/registered-conversation meetup id (the latter prefixed
// "registered:") to its request endpoint + any auth header it needs - shared by
// meetupAction and the silent background tracking updates below.
function meetupEndpoint(claimId, path) {
  const registeredId = String(claimId).startsWith('registered:') ? String(claimId).slice('registered:'.length) : null;
  const registeredConversation =
    registeredId && activeRegisteredFinderConversation?.id === registeredId ? activeRegisteredFinderConversation : null;
  const url = registeredConversation
    ? `/api/items/registered-conversations/${encodeURIComponent(registeredId)}${registeredConversation.role === 'finder' ? '/guest' : ''}/meetup/${path}`
    : `/api/items/claims/${encodeURIComponent(claimId)}/meetup/${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (registeredConversation?.role === 'finder') {
    headers.Authorization = `Bearer ${registeredConversation.token}`;
  }
  return { url, headers, registeredConversation };
}

async function meetupAction(claimId, path, body, button, busyLabel) {
  const { url, headers, registeredConversation } = meetupEndpoint(claimId, path);
  button.disabled = true;
  button.dataset.busy = 'true';
  const label = button.textContent;
  button.textContent = busyLabel;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
    });
    const data = await res.json();
    showToast(data.message || (data.success ? 'Done.' : 'Something went wrong.'), !data.success);
    if (data.success) {
      await loadNotificationsIntoModal({ silent: true });
      await loadMyNotifications();
      if (registeredConversation) await refreshClaimThread();
      else if (activeClaimThreadId === claimId) await refreshClaimThreadMeetup();
      return true;
    }
  } catch (error) {
    showToast('Network error. Please try again.', true);
  }
  button.disabled = false;
  delete button.dataset.busy;
  button.textContent = label;
  return false;
}

function requestMeetupLocation(claimId, button) {
  return meetupAction(claimId, 'request', {}, button, 'Sending request…');
}

function declineMeetupLocation(claimId, button) {
  return meetupAction(claimId, 'respond', { action: 'decline' }, button, 'Declining…');
}

function stopMeetupLocation(claimId, button) {
  stopMeetupTracking(claimId);
  return meetupAction(claimId, 'stop', {}, button, 'Stopping…');
}

// ── Live tracking while sharing is on ───────────────────────────────────────
// Once the first reading is shared, the sharer's own device keeps watching its
// position and quietly posts an updated reading as it moves, so the other person's
// map follows them instead of showing one fixed pin. Keyed by claimId (or the
// "registered:<id>" form) so at most one watch runs per conversation.
const activeMeetupTracking = new Map();
const MEETUP_TRACK_MIN_INTERVAL_MS = 15000;

function stopMeetupTracking(claimId) {
  const tracking = activeMeetupTracking.get(String(claimId));
  if (!tracking) return;
  navigator.geolocation.clearWatch(tracking.watchId);
  activeMeetupTracking.delete(String(claimId));
}

// Safe to call repeatedly (e.g. on every notifications refresh) - a no-op once a
// watch is already running for this claimId, and silent if the browser can't
// geolocate or the device never granted permission.
function ensureMeetupTracking(claimId) {
  const key = String(claimId);
  if (activeMeetupTracking.has(key) || !('geolocation' in navigator)) return;
  let lastSentAt = 0;
  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      if (Date.now() - lastSentAt < MEETUP_TRACK_MIN_INTERVAL_MS) return;
      lastSentAt = Date.now();
      sendMeetupLocationUpdate(claimId, position.coords);
    },
    () => {
      // Best-effort: a transient GPS error here shouldn't interrupt the last
      // position already shared, so it's ignored rather than shown to the user.
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
  );
  activeMeetupTracking.set(key, { watchId });
}

// A background position update: no button, no toast - loud feedback for every
// 15-second GPS tick would drown out the actual conversation.
async function sendMeetupLocationUpdate(claimId, coords) {
  const { url, headers } = meetupEndpoint(claimId, 'respond');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'share',
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy,
      }),
    });
    const data = await res.json();
    // The other side stopped the request, declined, or the claim closed -
    // nothing left to update into, so stop watching.
    if (!data.success) stopMeetupTracking(claimId);
  } catch (error) {
    // Network hiccup while moving; the next watch tick will just try again.
  }
}

// First reading from the device (GPS where available), sent after the student taps
// Share; a live watch then takes over so the map keeps following them while they share.
function shareMeetupLocation(claimId, button) {
  if (!('geolocation' in navigator)) {
    showToast('This browser cannot share a location.', true);
    return;
  }
  const note = button.closest('.meetup-incoming')?.querySelector('.meetup-note')?.value.trim() || '';
  button.disabled = true;
  button.dataset.busy = 'true';
  const label = button.textContent;
  button.textContent = 'Getting your location…';
  navigator.geolocation.getCurrentPosition(
    (position) => {
      button.textContent = label;
      meetupAction(
        claimId,
        'respond',
        {
          action: 'share',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          note,
        },
        button,
        'Sharing…'
      ).then((success) => {
        if (success) ensureMeetupTracking(claimId);
      });
    },
    (error) => {
      button.disabled = false;
      delete button.dataset.busy;
      button.textContent = label;
      const messages = {
        1: 'Location permission is blocked. Allow location for this site in your browser settings, then try again.',
        2: 'Your location is not available right now. Turn on GPS or location services and try again.',
        3: 'Getting your location took too long. Please try again.',
      };
      showToast(messages[error.code] || 'Your location could not be read.', true);
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
  );
}

// ── Claim conversation: messages + location sharing + mutual confirm ───────
// Opened once a claim request exists, so the claimant and the finder can agree the
// item matches, share where to meet, and each confirm the handover themselves -
// there is no separate admin approval step any more.

// Enter sends the message, same as clicking Send - delegated so it works whether
// the input is in starter mode or a normal thread. The form would already submit
// on Enter by default (it's a single text field plus a submit button), but this
// makes it explicit instead of relying on that implicit-submission browser rule.
document.addEventListener('keydown', (event) => {
  if (event.target.id !== 'claimThreadInput' || event.key !== 'Enter') return;
  event.preventDefault();
  event.target.closest('form')?.requestSubmit();
});

let activeClaimThreadId = null;
// Set instead of activeClaimThreadId while no claim exists yet for this match - the
// first message the claimant sends doubles as the claim's ownership proof.
let pendingClaimStart = null;
// How many messages renderClaimThread has already shown, so a background poll can
// tell which ones are new (and worth a toast) instead of just the full history.
let lastKnownThreadMessageCount = 0;
let claimThreadPollTimer = null;

// Polls while the conversation is open so a reply shows up without reopening the
// modal or refreshing the page; stops itself once the modal closes or the tab
// isn't visible (no point spending requests on a backgrounded tab).
function startClaimThreadPolling() {
  stopClaimThreadPolling();
  claimThreadPollTimer = setInterval(() => {
    if (!activeClaimThreadId && !activeRegisteredFinderConversation) {
      stopClaimThreadPolling();
      return;
    }
    if (document.visibilityState === 'visible') refreshClaimThread({ silent: true });
  }, 5000);
}

function stopClaimThreadPolling() {
  clearInterval(claimThreadPollTimer);
  claimThreadPollTimer = null;
}

function resetClaimThreadComposer() {
  document.querySelector('#claimThreadModal .thread-compose').hidden = false;
  resetClaimThreadHandover();
}

// ── Handover region (item, confirmation progress, location sharing) ─────────
// A side panel on wide screens and a collapsible bar on narrow ones (see the
// .thread-layout grid in css/meetup.css). The bar's one-line summary is what
// lets it stay collapsed without anything important being hidden.
const claimThreadWideQuery = window.matchMedia('(min-width: 860px)');
let lastRenderedThreadState = null;
let claimThreadHandoverAutoOpened = false;

function syncClaimThreadHandoverMode() {
  const toggle = document.getElementById('claimThreadHandoverToggle');
  const section = document.getElementById('claimThreadHandover');
  if (!toggle || !section) return;
  // On wide screens the panel is always open, so the toggle is just a heading.
  toggle.disabled = claimThreadWideQuery.matches;
  toggle.setAttribute(
    'aria-expanded',
    String(claimThreadWideQuery.matches || !section.classList.contains('is-collapsed'))
  );
}
claimThreadWideQuery.addEventListener?.('change', syncClaimThreadHandoverMode);

function setClaimThreadHandoverExpanded(expanded) {
  const section = document.getElementById('claimThreadHandover');
  if (!section) return;
  section.classList.toggle('is-collapsed', !expanded);
  syncClaimThreadHandoverMode();
}

function toggleClaimThreadHandover() {
  const section = document.getElementById('claimThreadHandover');
  if (!section || claimThreadWideQuery.matches) return;
  setClaimThreadHandoverExpanded(section.classList.contains('is-collapsed'));
  // A map that was laid out while hidden needs Leaflet to re-measure it.
  if (!section.classList.contains('is-collapsed')) {
    section.querySelectorAll('[data-meetup-map]').forEach((container) => {
      const map = activeMeetupMaps.get(container.id);
      if (map) requestAnimationFrame(() => map.invalidateSize());
    });
  }
}

function resetClaimThreadHandover() {
  lastRenderedThreadState = null;
  claimThreadHandoverAutoOpened = false;
  setClaimThreadHandoverExpanded(false);
  const section = document.getElementById('claimThreadHandover');
  if (section) delete section.dataset.tone;
  const summary = document.getElementById('claimThreadSummary');
  if (summary) summary.innerHTML = '';
  const barSummary = document.getElementById('claimThreadHandoverSummary');
  if (barSummary) barSummary.textContent = '';
}

// Picks the single most important line for the collapsed bar, most urgent first.
function claimThreadHandoverStatus(state, meetup) {
  if (!state) return { tone: '', text: pendingClaimStart ? 'Starts once you send your first message' : '' };
  const other = state.otherName;
  if (state.isCompleted) return { tone: 'done', text: 'Return complete' };
  const mine = meetup?.myLocation?.status;
  const theirs = meetup?.theirLocation?.status;
  if (mine === 'pending') return { tone: 'attention', text: `${other} is asking for your location` };
  if (state.confirmedByOther && !state.confirmedByMe) {
    return { tone: 'attention', text: `${other} confirmed · confirm once you have the item` };
  }
  if (mine === 'shared') return { tone: 'live', text: "You're live-sharing your location" };
  if (theirs === 'shared') return { tone: 'live', text: `${other} is sharing their location` };
  if (theirs === 'pending') return { tone: 'waiting', text: `Waiting for ${other}'s location` };
  if (state.confirmedByMe) return { tone: 'waiting', text: `Waiting for ${other} to confirm` };
  return { tone: '', text: meetup ? 'Arrange where to meet' : `Confirm with ${other} that it's a match` };
}

function updateClaimThreadHandover() {
  const section = document.getElementById('claimThreadHandover');
  if (!section) return;
  const state = lastRenderedThreadState;
  const status = claimThreadHandoverStatus(state, lastRenderedThreadMeetup);
  if (status.tone) section.dataset.tone = status.tone;
  else delete section.dataset.tone;
  document.getElementById('claimThreadHandoverSummary').textContent = status.text;

  const summary = document.getElementById('claimThreadSummary');
  if (!state) {
    summary.innerHTML = '';
  } else {
    const other = escapeHtml(state.otherName);
    const me = state.isCompleted || state.confirmedByMe;
    const them = state.isCompleted || state.confirmedByOther;
    summary.innerHTML = `
      <p class="thread-summary-item">
        <span class="thread-summary-kicker">Item</span>
        <strong>${escapeHtml(state.itemTitle)}</strong>
      </p>
      <ul class="thread-steps" aria-label="Return confirmation">
        <li class="${me ? 'is-done' : ''}">${me ? 'You confirmed' : "You haven't confirmed yet"}</li>
        <li class="${them ? 'is-done' : ''}">${them ? `${other} confirmed` : `${other} hasn't confirmed yet`}</li>
      </ul>`;
  }

  // A location request needs an answer: open the bar once so it isn't missed.
  if (status.tone === 'attention' && !claimThreadHandoverAutoOpened && !claimThreadWideQuery.matches) {
    claimThreadHandoverAutoOpened = true;
    setClaimThreadHandoverExpanded(true);
  }
}

async function openClaimThreadModal(claimId) {
  if (!claimId) return;
  closeNotificationsModal();
  resetClaimThreadComposer();
  activeRegisteredFinderConversation = null;
  activeClaimThreadId = claimId;
  pendingClaimStart = null;
  lastKnownThreadMessageCount = 0;
  document.getElementById('claimThreadInput').placeholder = 'Type a message…';
  document.getElementById('claimThreadBody').innerHTML = '<p class="thread-empty">Loading…</p>';
  destroyMeetupMapsWithin(document.getElementById('claimThreadMeetup'));
  document.getElementById('claimThreadMeetup').innerHTML = '';
  lastRenderedThreadMeetup = null;
  document.getElementById('claimThreadConfirm').innerHTML = '';
  document.getElementById('claimThreadModal').classList.add('open');
  await refreshClaimThread();
  startClaimThreadPolling();
}

function registeredConversationEndpoint(conversation, suffix = '') {
  const rolePath = conversation.role === 'finder' ? '/guest' : '';
  return `/api/items/registered-conversations/${encodeURIComponent(conversation.id)}${rolePath}${suffix}`;
}

function registeredConversationHeaders(conversation, json = false) {
  const headers = json ? { 'Content-Type': 'application/json' } : {};
  if (conversation.role === 'finder') headers.Authorization = `Bearer ${conversation.token}`;
  return headers;
}

async function openRegisteredFinderConversation(conversationId, token) {
  if (!conversationId || !token) return;
  saveFinderConversation({ id: conversationId, token });
  closeNotificationsModal();
  closeAnonymousFinderModal();
  resetClaimThreadComposer();
  activeClaimThreadId = null;
  pendingClaimStart = null;
  activeRegisteredFinderConversation = { id: conversationId, token, role: 'finder' };
  lastKnownThreadMessageCount = 0;
  document.getElementById('claimThreadInput').placeholder = 'Type a message…';
  document.getElementById('claimThreadBody').innerHTML = '<p class="thread-empty">Loading conversation…</p>';
  destroyMeetupMapsWithin(document.getElementById('claimThreadMeetup'));
  document.getElementById('claimThreadMeetup').innerHTML = '';
  lastRenderedThreadMeetup = null;
  document.getElementById('claimThreadConfirm').innerHTML = '';
  document.getElementById('claimThreadModal').classList.add('open');
  await refreshClaimThread();
  startClaimThreadPolling();
}

function openSavedFinderConversation(conversationId) {
  const saved = getSavedFinderConversations().find((entry) => entry.id === conversationId);
  if (!saved) {
    showToast('This saved finder conversation is no longer available on this browser.', true);
    return;
  }
  openRegisteredFinderConversation(saved.id, saved.token);
}

async function openRegisteredOwnerConversation(conversationId) {
  if (!conversationId) return;
  closeNotificationsModal();
  resetClaimThreadComposer();
  activeClaimThreadId = null;
  pendingClaimStart = null;
  activeRegisteredFinderConversation = { id: conversationId, role: 'owner' };
  lastKnownThreadMessageCount = 0;
  document.getElementById('claimThreadInput').placeholder = 'Type a message…';
  document.getElementById('claimThreadBody').innerHTML = '<p class="thread-empty">Loading conversation…</p>';
  destroyMeetupMapsWithin(document.getElementById('claimThreadMeetup'));
  document.getElementById('claimThreadMeetup').innerHTML = '';
  lastRenderedThreadMeetup = null;
  document.getElementById('claimThreadConfirm').innerHTML = '';
  document.getElementById('claimThreadModal').classList.add('open');
  await refreshClaimThread();
  startClaimThreadPolling();
}

// Opened when no claim exists yet for this match - describing the item IS the
// claim request, submitted the moment the claimant sends their first message.
function openClaimThreadStarter(lostId, foundId, foundTitle, requesterRole) {
  stopClaimThreadPolling();
  resetClaimThreadComposer();
  activeRegisteredFinderConversation = null;
  activeClaimThreadId = null;
  pendingClaimStart = { lostId, foundId };
  lastKnownThreadMessageCount = 0;
  document.getElementById('claimThreadTitle').textContent = `Claim conversation · ${foundTitle || 'Item'}`;
  document.getElementById('claimThreadSubtitle').textContent = 'Starts once you send your first message';
  document.getElementById('claimThreadBody').innerHTML =
    requesterRole === 'finder'
      ? '<p class="thread-empty">Send the owner a message - where you found it, or ask them to confirm a detail - to start the conversation.</p>'
      : '<p class="thread-empty">Describe an identifying detail only the real owner would know, then send it to start the conversation with the finder.</p>';
  destroyMeetupMapsWithin(document.getElementById('claimThreadMeetup'));
  document.getElementById('claimThreadMeetup').innerHTML = '';
  lastRenderedThreadMeetup = null;
  document.getElementById('claimThreadConfirm').innerHTML = '';
  document.getElementById('claimThreadInput').placeholder =
    requesterRole === 'finder'
      ? 'e.g. Found it near the gym entrance, handed it to campus security.'
      : "e.g. There's a small scratch near the charging port, and a blue sticker inside the lid.";
  updateClaimThreadHandover();
  document.getElementById('claimThreadModal').classList.add('open');
}

function closeClaimThreadModal() {
  activeClaimThreadId = null;
  activeRegisteredFinderConversation = null;
  pendingClaimStart = null;
  stopClaimThreadPolling();
  document.getElementById('claimThreadModal').classList.remove('open');
}

// Consecutive messages from the same sender within this window render as one
// tight run (see .thread-msg--grouped / --continued in css/meetup.css).
const THREAD_GROUP_WINDOW_MS = 5 * 60 * 1000;

function claimThreadMessageTime(message) {
  return new Date(message.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function claimThreadSameRun(a, b) {
  return (
    Boolean(a && b) &&
    a.mine === b.mine &&
    Math.abs(new Date(b.createdAt) - new Date(a.createdAt)) <= THREAD_GROUP_WINDOW_MS
  );
}

function claimThreadMessagesHtml(messages) {
  return messages
    .map((message, index) => {
      const prev = messages[index - 1];
      const next = messages[index + 1];
      const grouped = claimThreadSameRun(prev, message);
      const continued = claimThreadSameRun(message, next);
      const time = claimThreadMessageTime(message);
      // Within a run, a timestamp repeated by the next bubble adds nothing - show it once, on the last.
      const showTime = !continued || claimThreadMessageTime(next) !== time;
      const classes = [
        'thread-msg',
        message.mine ? 'thread-msg--mine' : 'thread-msg--theirs',
        grouped ? 'thread-msg--grouped' : '',
        continued ? 'thread-msg--continued' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `
    <div class="${classes}">
      <p class="thread-msg-text">${escapeHtml(message.text)}</p>
      ${showTime ? `<span class="thread-msg-time">${time}</span>` : ''}
    </div>`;
    })
    .join('');
}

// Smooth for new messages in an open thread; instant on first load so opening
// a long conversation doesn't animate from the top.
function scrollClaimThreadToEnd(body, { smooth = true } = {}) {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  body.scrollTo({ top: body.scrollHeight, behavior: smooth && !reduceMotion ? 'smooth' : 'auto' });
}

// Renders the thread and, on a background poll, toasts about any message the
// other person sent since the last time this was called.
function applyClaimThreadUpdate(thread, { silent = false } = {}) {
  const newFromOther = thread.messages.slice(lastKnownThreadMessageCount).filter((m) => !m.mine);
  if (silent && newFromOther.length) {
    showToast(
      newFromOther.length > 1
        ? `${newFromOther.length} new messages from ${thread.otherName}`
        : `New message from ${thread.otherName}`
    );
  }
  lastKnownThreadMessageCount = thread.messages.length;
  renderClaimThread(thread);
}

function renderClaimThread(thread) {
  const isRegisteredConversation = Boolean(activeRegisteredFinderConversation);
  const isCompleted = thread.claim.status === 'approved' || thread.claim.status === 'returned';
  document.getElementById('claimThreadTitle').textContent =
    `${isRegisteredConversation ? 'QR finder conversation' : 'Claim conversation'} · ${thread.item.title}`;
  document.getElementById('claimThreadSubtitle').textContent = `You and ${thread.otherName}`;

  const body = document.getElementById('claimThreadBody');
  const wasScrolledToEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 48;
  const previousCount = body.querySelectorAll('.thread-msg').length;
  const isFirstRender = previousCount === 0;
  const newest = thread.messages[thread.messages.length - 1];
  const iJustSent = thread.messages.length > previousCount && Boolean(newest?.mine);
  const previousScrollTop = body.scrollTop;
  const html = thread.messages.length
    ? claimThreadMessagesHtml(thread.messages)
    : isCompleted
      ? '<p class="thread-empty">This claim is complete. No messages are available in this conversation.</p>'
      : '<p class="thread-empty">No messages yet. Say hello and describe the item to confirm it\'s a match.</p>';
  // The 5s poll re-renders even when nothing changed; skipping identical HTML
  // keeps a reader's scroll position and any in-progress smooth scroll intact.
  // (Compared against a cached copy, not body.innerHTML, which the browser
  // re-serializes; the firstChild check catches the "Loading…" placeholder.)
  const unchanged = body._renderedHtml === html && body._renderedFirstChild === body.firstChild;
  if (!unchanged) {
    body.innerHTML = html;
    body._renderedHtml = html;
    body._renderedFirstChild = body.firstChild;
    if (isFirstRender) scrollClaimThreadToEnd(body, { smooth: false });
    else if (wasScrolledToEnd || iJustSent) scrollClaimThreadToEnd(body);
    else body.scrollTop = previousScrollTop;
  }

  document.querySelector('#claimThreadModal .thread-compose').hidden = isCompleted;
  const confirmBox = document.getElementById('claimThreadConfirm');
  if (isCompleted) {
    confirmBox.innerHTML = `
      <p class="thread-resolved">✅ Both sides confirmed. The return is complete.</p>
      <p class="thread-readonly">This conversation is now read-only. New messages are disabled.</p>`;
  } else if (thread.confirmedByMe) {
    confirmBox.innerHTML = `<p class="thread-waiting">You confirmed. Waiting for ${escapeHtml(thread.otherName)} to confirm too…</p>`;
  } else {
    confirmBox.innerHTML = `
      <button type="button" class="btn btn-primary btn-compact" data-action="confirmClaimThread">✓ Confirm item ${isRegisteredConversation ? 'returned' : 'received/returned'}</button>
      ${thread.confirmedByOther ? `<p class="thread-waiting">${escapeHtml(thread.otherName)} already confirmed.</p>` : ''}`;
  }
  lastRenderedThreadState = {
    otherName: thread.otherName,
    itemTitle: thread.item.title,
    isCompleted,
    confirmedByMe: Boolean(thread.confirmedByMe),
    confirmedByOther: Boolean(thread.confirmedByOther),
  };
  if (isCompleted) renderClaimThreadMeetupNotification(null);
  else if (thread.meetupNotification) renderClaimThreadMeetupNotification(thread.meetupNotification);
  updateClaimThreadHandover();
}

// The last meetup notification fully rendered into the claim-thread box, so the 5s
// poll (refreshClaimThreadMeetup) can tell a plain movement update (same shared
// location, just a new reading) from an actual change of state - only the former can
// be patched in place; see canUpdateMeetupMapInPlace / updateMeetupMapInPlace below.
let lastRenderedThreadMeetup = null;

// True when `next` is the same live share as `prev`, just a later reading - the map
// is already showing it, so the pin can glide to its new spot (CSS transition on
// .meetup-pin-wrap) instead of the whole box being torn down and rebuilt.
function canUpdateMeetupMapInPlace(prev, next, mapExpanded) {
  if (!mapExpanded || !prev || !next || prev.claimId !== next.claimId) return false;
  if (prev.myLocation?.status !== next.myLocation?.status) return false;
  const prevLocation = prev.theirLocation;
  const nextLocation = next.theirLocation;
  if (prevLocation?.status !== 'shared' || nextLocation?.status !== 'shared') return false;
  if (!prevLocation.location || !nextLocation.location) return false;
  if (prevLocation.location.note !== nextLocation.location.note) return false;
  const containerId = `meetup-map-thread-${String(next.claimId).replace(/[^\w-]/g, '')}`;
  return activeMeetupMaps.has(containerId);
}

function updateMeetupMapInPlace(meetupBox, notification) {
  const location = notification.theirLocation.location;
  const lat = Number(location.latitude.toFixed(6));
  const lng = Number(location.longitude.toFixed(6));
  const containerId = `meetup-map-thread-${String(notification.claimId).replace(/[^\w-]/g, '')}`;
  const container = document.getElementById(containerId);
  const marker = activeMeetupMarkers.get(containerId);
  const circle = activeMeetupCircles.get(containerId);
  if (container) {
    container.dataset.lat = String(lat);
    container.dataset.lng = String(lng);
    container.dataset.accuracy = String(location.accuracy);
  }
  if (marker) marker.setLatLng([lat, lng]);
  if (circle) {
    circle.setLatLng([lat, lng]);
    circle.setRadius(location.accuracy);
  }
  const theirHint = meetupBox.querySelector('.meetup-section .meetup-hint');
  if (theirHint) {
    theirHint.textContent = `Shared ${relativeTimeLabel(new Date(location.sharedAt))} · accurate to about ${location.accuracy} m · visible until ${meetupTime(location.expiresAt)}`;
  }
  if (notification.myLocation?.status === 'shared' && notification.myLocation.expiresAt) {
    const myHint = meetupBox.querySelector('.meetup-sharing .meetup-hint');
    if (myHint) {
      myHint.textContent = `Keeps updating until ${meetupTime(notification.myLocation.expiresAt)} unless you stop sharing sooner.`;
    }
  }
}

// The location-sharing section is driven by the same meetup notification the
// inbox uses - reused here instead of duplicating that request/respond logic.
function renderClaimThreadMeetupNotification(notification) {
  const meetupBox = document.getElementById('claimThreadMeetup');
  const mapExpanded = Boolean(meetupBox.querySelector('.meetup-map-toggle[aria-expanded="true"]'));

  if (canUpdateMeetupMapInPlace(lastRenderedThreadMeetup, notification, mapExpanded)) {
    updateMeetupMapInPlace(meetupBox, notification);
    lastRenderedThreadMeetup = notification;
    updateClaimThreadHandover();
    return;
  }
  lastRenderedThreadMeetup = notification;

  destroyMeetupMapsWithin(meetupBox);
  meetupBox.innerHTML = notification ? meetupNotificationHtml(notification, 'thread-', mapExpanded) : '';
  // If I'm the one sharing (e.g. after a page reload wiped the in-memory watch),
  // pick tracking back up so the other person's map keeps following me.
  if (notification?.myLocation?.status === 'shared') ensureMeetupTracking(notification.claimId);
  const mapToggle = meetupBox.querySelector('.meetup-map-toggle');
  if (mapToggle) {
    mapToggle.addEventListener('click', () => {
      const panel = document.getElementById(mapToggle.getAttribute('aria-controls'));
      if (!panel) return;
      const expanded = panel.hidden;
      panel.hidden = !expanded;
      mapToggle.setAttribute('aria-expanded', String(expanded));
      mapToggle.textContent = expanded ? 'Hide Map' : 'Show Map';
      if (expanded) {
        const container = panel.querySelector('[data-meetup-map]');
        let map = container && activeMeetupMaps.get(container.id);
        if (container && !map) {
          initMeetupMaps(panel);
          map = activeMeetupMaps.get(container.id);
        }
        if (map) requestAnimationFrame(() => map.invalidateSize());
      }
    });
  }
  if (mapExpanded) initMeetupMaps(meetupBox);
  updateClaimThreadHandover();
}

async function refreshClaimThreadMeetup() {
  if (!activeClaimThreadId) return;
  try {
    const res = await fetch('/api/items/my-notifications', { cache: 'no-store' });
    const data = await res.json();
    const notification = data.notifications?.find(
      (n) => n.notificationType === 'meetup' && n.claimId === activeClaimThreadId
    );
    renderClaimThreadMeetupNotification(notification);
  } catch (error) {
    // Location sharing is secondary to the conversation itself; fail quietly.
  }
}

async function refreshClaimThread({ silent = false } = {}) {
  const claimId = activeClaimThreadId;
  const registeredConversation = activeRegisteredFinderConversation;
  if (!claimId && !registeredConversation) return;
  try {
    const res = registeredConversation
      ? await fetch(registeredConversationEndpoint(registeredConversation), {
          cache: 'no-store',
          headers: registeredConversationHeaders(registeredConversation),
        })
      : await fetch(`/api/items/claims/${encodeURIComponent(claimId)}/thread`, { cache: 'no-store' });
    const thread = await res.json();
    if (!res.ok || !thread.success) {
      if (!silent) {
        showToast(thread.message || 'This conversation is no longer available.', true);
        closeClaimThreadModal();
      }
      return;
    }
    applyClaimThreadUpdate(thread, { silent });
    if (registeredConversation) renderClaimThreadMeetupNotification(thread.meetupNotification);
    else if (thread.claim.status === 'approved' || thread.claim.status === 'returned') {
      renderClaimThreadMeetupNotification(null);
    } else await refreshClaimThreadMeetup();
  } catch (error) {
    if (!silent) showToast('Could not load the conversation. Please try again.', true);
  }
}

async function sendClaimThreadMessage(event) {
  event.preventDefault();
  const button = document.getElementById('claimThreadSendBtn');
  // A send is already in flight (Enter key and the Send button both route here,
  // and the prior guard only set button.disabled without checking it first, so
  // a fast double-click/double-Enter slipped through and fired two requests).
  if (button.disabled) return;
  const input = document.getElementById('claimThreadInput');
  const text = input.value.trim();
  if (!text || (!activeClaimThreadId && !activeRegisteredFinderConversation && !pendingClaimStart)) return;
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = 'Sending…';
  try {
    if (pendingClaimStart) {
      const res = await fetch(`/api/items/${encodeURIComponent(pendingClaimStart.foundId)}/claim-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proof: text, lostId: pendingClaimStart.lostId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Could not start the conversation.');
      pendingClaimStart = null;
      activeClaimThreadId = data.claim.id;
      input.value = '';
      input.placeholder = 'Type a message…';
      await refreshClaimThread();
      startClaimThreadPolling();
      return;
    }
    const registeredConversation = activeRegisteredFinderConversation;
    const res = registeredConversation
      ? await fetch(registeredConversationEndpoint(registeredConversation, '/messages'), {
          method: 'POST',
          headers: registeredConversationHeaders(registeredConversation, true),
          body: JSON.stringify({ text }),
        })
      : await fetch(`/api/items/claims/${encodeURIComponent(activeClaimThreadId)}/thread/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Could not send that message.');
    input.value = '';
    applyClaimThreadUpdate(data);
  } catch (error) {
    showToast(error.message || 'Network error. Please try again.', true);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
    input.focus();
  }
}

async function confirmClaimThread() {
  if (!activeClaimThreadId && !activeRegisteredFinderConversation) return;
  const isRegisteredConversation = Boolean(activeRegisteredFinderConversation);
  const confirmed = await askConfirmItemReturned(isRegisteredConversation);
  if (!confirmed) return;
  try {
    const conversation = activeRegisteredFinderConversation;
    const res = conversation
      ? await fetch(registeredConversationEndpoint(conversation, '/confirm'), {
          method: 'POST',
          headers: registeredConversationHeaders(conversation, true),
          body: JSON.stringify({}),
        })
      : await fetch(`/api/items/claims/${encodeURIComponent(activeClaimThreadId)}/thread/confirm`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Could not confirm.');
    applyClaimThreadUpdate(data);
    if (data.claim.status === 'approved' || data.claim.status === 'returned') {
      showToast(isRegisteredConversation ? 'The return is confirmed by both people.' : 'Item marked as claimed.');
      if (!isRegisteredConversation) fetchAndRenderItems();
    }
  } catch (error) {
    showToast(error.message || 'Network error. Please try again.', true);
  }
}

async function deleteClaimThread() {
  if (!activeClaimThreadId) return;
  const confirmed = await askConfirm('Delete this conversation? This cannot be undone.', {
    title: 'Delete conversation?',
    confirmLabel: 'Delete',
    icon: '🗑️',
  });
  if (!confirmed) return;
  try {
    const res = await fetch(`/api/items/claims/${encodeURIComponent(activeClaimThreadId)}/thread`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Could not delete the conversation.');
    showToast(data.message || 'Conversation deleted.');
    closeClaimThreadModal();
  } catch (error) {
    showToast(error.message || 'Network error. Please try again.', true);
  }
}

function setNotificationsFilter(filter) {
  const tabs = [...document.querySelectorAll('.notification-filter-tab')];
  if (!tabs.some((tab) => tab.dataset.filter === filter)) return;

  tabs.forEach((tab) => {
    const active = tab.dataset.filter === filter;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-pressed', String(active));
  });

  document.querySelectorAll('#notificationsList .notif-item').forEach((item) => {
    item.hidden = filter !== 'all' && item.dataset.category !== filter;
  });
}

async function loadNotificationsIntoModal({ silent = false } = {}) {
  const list = document.getElementById('notificationsList');
  const requestId = ++notificationsLoadRequestId;
  if (!silent) {
    destroyMeetupMaps();
    list.innerHTML = '<p class="notif-empty">Loading…</p>';
  }
  try {
    let data = { success: true, notifications: [], unreadCount: 0 };
    if (currentUser) {
      const res = await fetch('/api/items/my-notifications');
      data = await res.json();
      if (requestId !== notificationsLoadRequestId) return;
      if (!res.ok || !data.success) {
        if (!silent) {
          document.getElementById('notificationSelectionToolbar').hidden = true;
          list.innerHTML = '<p class="notif-empty">Could not load notifications.</p>';
        } else {
          console.error('Could not refresh notifications:', data.message || 'Notification refresh failed.');
        }
        return;
      }
    }

    const guestConversations = await loadSavedFinderConversationNotifications();
    if (requestId !== notificationsLoadRequestId) return;
    const notifications = [...data.notifications, ...guestConversations];
    const renderKey = JSON.stringify({ notifications, unreadCount: data.unreadCount || 0 });
    if (!notifications.length) {
      document.getElementById('notificationSelectionToolbar').hidden = true;
      if (!silent || list.dataset.renderKey !== renderKey) {
        destroyMeetupMaps();
        list.innerHTML = `<p class="notif-empty">${currentUser ? 'No account notifications or saved finder conversations yet.' : 'No saved finder conversations on this browser yet.'}</p>`;
        list.dataset.renderKey = renderKey;
      }
      list.dataset.loaded = 'true';
      return;
    }

    document.getElementById('notificationSelectionToolbar').hidden = !currentUser || !data.notifications.length;
    const notificationMarkup = notifications
      .map((n) =>
        n.notificationType === 'guest-finder-conversation'
          ? `
      <div class="notif-item notif-item--message notif-item--guest-finder-conversation${n.conversationStatus === 'returned' ? '' : ' unread'}" data-id="${escapeHtml(String(n.id))}" data-category="conversation">
        <div class="notif-header">
          <div class="notif-title-group">
            <span class="notif-title-icon" aria-hidden="true">💬</span>
            <strong>QR finder · ${escapeHtml(n.itemTitle || 'Registered item')}</strong>
          </div>
          <span class="notif-time">${new Date(n.timestamp).toLocaleString()}</span>
        </div>
        <div class="notif-body">
          <span class="notif-badge notif-badge--conversation${
            n.conversationStatus === 'returned'
              ? ' notif-badge--resolved'
              : n.conversationStatus === 'expired'
                ? ' notif-badge--expired'
                : ''
          }">${
            n.conversationStatus === 'expired'
              ? 'Expired'
              : n.conversationStatus === 'returned'
                ? 'Return confirmed'
                : 'Saved conversation'
          }</span>
          <p class="notif-msg">Saved on this browser so you can return to the conversation after closing the page.</p>
          ${n.lastMessage ? `<p class="notif-msg">${escapeHtml(n.lastMessage)}</p>` : ''}
          ${
            n.loadError
              ? '<p class="notif-contact">Could not refresh this conversation. Your saved access is still available; try again shortly.</p>'
              : n.conversationStatus === 'expired'
                ? '<p class="notif-contact">This conversation has expired.</p>'
                : n.conversationStatus === 'returned'
                  ? '<p class="notif-contact">Both sides confirmed the return.</p>'
                  : ''
          }
        </div>
        <div class="notif-actions">
          <div class="notif-actions-primary">
            ${
              n.conversationStatus !== 'expired'
                ? `<button type="button" class="btn btn-primary btn-compact" data-action="openSavedFinderConversation" data-args="${actionArgs(n.conversationId)}">Open conversation</button>`
                : ''
            }
          </div>
          <div class="notif-actions-secondary">
            <button type="button" class="btn-delete-conversation" data-action="removeSavedFinderConversationFromInbox" data-args="${actionArgs(n.conversationId, '$el')}">Remove from this browser</button>
          </div>
        </div>
      </div>
    `
          : n.notificationType === 'finder-conversation'
            ? `
      <div class="notif-item notif-item--message notif-item--finder-conversation${n.read ? '' : ' unread'}" data-id="${escapeHtml(String(n.id))}" data-category="conversation">
        <div class="notif-header">
          <div class="notif-title-group">
            <label class="notification-select-control">
              <span class="notification-select-box">
                <input class="notification-select" type="checkbox" value="${escapeHtml(
                  JSON.stringify({
                    kind: 'item',
                    recordId: String(n.itemId),
                    id: String(n.id),
                  })
                )}" data-change="updateNotificationSelection">
                <span class="notification-select-check" aria-hidden="true"></span>
              </span>
              <span class="visually-hidden">Select conversation</span>
            </label>
            <span class="notif-title-icon" aria-hidden="true">💬</span>
            <strong>QR finder · ${escapeHtml(n.itemTitle || n.refCode || 'Item')}</strong>
          </div>
          <span class="notif-time">${new Date(n.timestamp).toLocaleString()}</span>
        </div>
        <div class="notif-body">
          <span class="notif-badge notif-badge--conversation${
            Date.parse(n.conversationExpiresAt) > Date.now() ? '' : ' notif-badge--expired'
          }">${
            Date.parse(n.conversationExpiresAt) > Date.now() ? 'Active conversation' : 'Expired'
          }</span>
          <p class="notif-msg"><strong>${escapeHtml(n.finderContact && n.finderContact !== 'Anonymous Student / Finder' ? n.finderContact : 'Anonymous finder')}</strong> started a secure conversation after scanning the item QR code.</p>
          <p class="notif-msg">${escapeHtml(n.lastMessage || n.message || '')}</p>
          ${Date.parse(n.conversationExpiresAt) <= Date.now() ? '<p class="notif-contact">This conversation has expired.</p>' : ''}
        </div>
        <div class="notif-actions">
          <div class="notif-actions-primary">
            ${
              Date.parse(n.conversationExpiresAt) > Date.now()
                ? `<button type="button" class="btn btn-primary btn-compact" data-action="openRegisteredOwnerConversation" data-args="${actionArgs(n.conversationId)}">Open conversation</button>`
                : ''
            }
          </div>
          <div class="notif-actions-secondary">
            <button type="button" class="btn-delete-conversation" data-action="deleteRegisteredConversationNotification" data-args="${actionArgs(n.id, n.itemId, '$el')}">Delete conversation</button>
          </div>
        </div>
      </div>
    `
            : n.notificationType === 'claim-conversation'
              ? `
      <div class="notif-item notif-item--message notif-item--claim-conversation${n.read ? '' : ' unread'}" data-id="${escapeHtml(String(n.id))}" data-category="conversation">
        <div class="notif-header">
          <div class="notif-title-group">
            <label class="notification-select-control">
              <span class="notification-select-box">
                <input class="notification-select" type="checkbox" value="${escapeHtml(
                  JSON.stringify({
                    kind: 'claim-conversation',
                    recordId: String(n.claimId),
                    id: String(n.id),
                  })
                )}" data-change="updateNotificationSelection">
                <span class="notification-select-check" aria-hidden="true"></span>
              </span>
              <span class="visually-hidden">Select conversation</span>
            </label>
            <span class="notif-title-icon" aria-hidden="true">💬</span>
            <strong>Claim conversation · ${escapeHtml(n.itemTitle || n.refCode || 'Item')}</strong>
          </div>
          <span class="notif-time">${new Date(n.timestamp).toLocaleString()}</span>
        </div>
        <div class="notif-body">
          <span class="notif-badge notif-badge--conversation${
            !n.unreadCount && n.status === 'approved' ? ' notif-badge--resolved' : ''
          }">${
            n.unreadCount
              ? `${n.unreadCount} new message${n.unreadCount === 1 ? '' : 's'}`
              : n.status === 'approved'
                ? 'Handover confirmed'
                : 'Conversation in progress'
          }</span>
          <p class="notif-msg"><strong>${escapeHtml(n.otherName)}</strong>${
            n.unreadCount
              ? ` sent ${n.unreadCount} new message${n.unreadCount === 1 ? '' : 's'}`
              : n.status === 'approved'
                ? ' · return complete'
                : ' · conversation in progress'
          }</p>
          ${
            n.message
              ? `<p class="notif-msg">${escapeHtml(n.message)}</p>`
              : '<p class="notif-msg">Open this conversation to continue discussing the potential match.</p>'
          }
        </div>
        <div class="notif-actions">
          <div class="notif-actions-primary">
            <button type="button" class="btn btn-primary btn-compact" data-action="openClaimThreadModal" data-args="${actionArgs(n.claimId)}">Open conversation</button>
          </div>
          <div class="notif-actions-secondary">
            <button type="button" class="btn-delete-conversation" data-action="deleteClaimConversationNotification" data-args="${actionArgs(n.claimId, '$el')}">Delete conversation</button>
          </div>
        </div>
      </div>
    `
              : n.notificationType === 'meetup'
                ? `
      <div class="notif-item notif-item--meetup${n.read ? '' : ' unread'}" data-id="${escapeHtml(String(n.id))}" data-category="conversation">
        <div class="notif-header">
          <div class="notif-title-group">
            <span class="notif-title-icon" aria-hidden="true">🏷️</span>
            <strong>${escapeHtml(n.itemTitle || n.refCode || 'Item')}</strong>
          </div>
          <span class="notif-time">${new Date(n.timestamp).toLocaleString()}</span>
        </div>
        ${meetupNotificationHtml(n, '', false, true)}
      </div>
    `
                : n.notificationType === 'claim-message'
                  ? `
      <div class="notif-item notif-item--message unread" data-id="${escapeHtml(String(n.id))}" data-category="conversation">
        <div class="notif-header">
          <div class="notif-title-group">
            <span class="notif-title-icon" aria-hidden="true">💬</span>
            <strong>${escapeHtml(n.itemTitle || n.refCode || 'Item')}</strong>
          </div>
          <span class="notif-time">${new Date(n.timestamp).toLocaleString()}</span>
        </div>
        <div class="notif-body">
          <span class="notif-badge notif-badge--conversation">New message</span>
          <p class="notif-msg"><strong>${escapeHtml(n.otherName)}</strong>${n.unreadCount > 1 ? ` sent ${n.unreadCount} messages` : ' replied'}</p>
          <p class="notif-msg">${escapeHtml(n.message)}</p>
        </div>
        <div class="notif-actions">
          <div class="notif-actions-primary">
            <button type="button" class="btn btn-primary btn-compact" data-action="openClaimThreadModal" data-args="${actionArgs(n.claimId)}">Open conversation</button>
          </div>
        </div>
      </div>
    `
                  : `
      <div class="notif-item${n.read ? '' : ' unread'}" data-id="${escapeHtml(String(n.id))}" data-category="alert">
        <div class="notif-header">
          <div class="notif-title-group">
            <label class="notification-select-control">
              <span class="notification-select-box">
                <input class="notification-select" type="checkbox" value="${escapeHtml(
                  JSON.stringify({
                    kind: n.notificationType === 'claim' ? 'claim' : 'item',
                    recordId: String(n.notificationType === 'claim' ? n.claimId : n.itemId),
                    id: String(n.id),
                  })
                )}" data-change="updateNotificationSelection">
                <span class="notification-select-check" aria-hidden="true"></span>
              </span>
              <span class="visually-hidden">Select notification</span>
            </label>
            <span class="notif-title-icon" aria-hidden="true">🏷️</span>
            <strong>${n.itemTitle || n.refCode}</strong>
          </div>
          <span class="notif-time">${new Date(n.timestamp).toLocaleString()}</span>
        </div>
        <div class="notif-body">
          <span class="notif-badge notif-badge--alert">${
            n.notificationType === 'match'
              ? 'Possible match—not confirmed'
              : n.notificationType === 'claim'
                ? 'Claim request update'
                : 'Lost & Found alert'
          }</span>
          ${
            n.notificationType === 'match'
              ? `<p class="notif-msg">Found item: ${escapeHtml(n.matchItemTitle || n.matchRefCode || 'Found item')} ${n.matchRefCode ? `(${escapeHtml(n.matchRefCode)})` : ''}</p>
               ${n.matchLocation ? `<p class="notif-msg">Reported location: ${escapeHtml(n.matchLocation)}</p>` : ''}
               <p class="notif-msg">${escapeHtml(n.message)}</p>`
              : n.notificationType === 'claim'
                ? `<p class="notif-msg">${escapeHtml(n.message)}</p>`
                : `<p class="notif-msg">📍 <em>${escapeHtml(n.locationFound || 'Location not specified')}</em></p>
                   <p class="notif-msg">💬 ${escapeHtml(n.message)}</p>
                   ${
                     n.finderContact && n.finderContact !== 'Anonymous Student / Finder'
                       ? `<p class="notif-contact">📞 Contact the finder: ${contactLinkHtml(n.finderContact)}</p>`
                       : '<p class="notif-contact">🔒 Finder remained anonymous</p>'
                   }`
          }
        </div>
        ${
          n.notificationType === 'match' || !n.read
            ? `<div class="notif-actions">
                 <div class="notif-actions-primary">
                   ${
                     n.notificationType === 'match'
                       ? `<a class="btn btn-primary btn-compact notif-action-link" href="/?search=${encodeURIComponent(n.matchRefCode || '')}&amp;matchItemId=${encodeURIComponent(n.matchItemId || '')}#items">Review possible match</a>`
                       : ''
                   }
                 </div>
                 <div class="notif-actions-secondary">
                   ${!n.read ? `<button type="button" class="btn-mark-read" data-action="markNotifRead" data-args="${actionArgs(n.id, '$el')}">Mark as read</button>` : ''}
                 </div>
               </div>`
            : ''
        }
      </div>
    `
      )
      .join('');
    if (!silent || list.dataset.renderKey !== renderKey) {
      const scrollTop = list.scrollTop;
      const activeFilter =
        document.querySelector('.notification-filter-tab[aria-pressed="true"]')?.dataset.filter || 'all';
      destroyMeetupMaps();
      list.innerHTML = notificationMarkup;
      list.scrollTop = scrollTop;
      list.dataset.renderKey = renderKey;
      setNotificationsFilter(activeFilter);
      document.getElementById('selectAllNotifications').checked = false;
      updateNotificationSelection();
      initMeetupMaps();
    }
    list.dataset.loaded = 'true';
    // If I'm the one sharing on any of these (e.g. after a page reload wiped the
    // in-memory watch), pick tracking back up for each.
    notifications
      .filter((n) => n.notificationType === 'meetup' && n.myLocation?.status === 'shared')
      .forEach((n) => ensureMeetupTracking(n.claimId));

    // Update badge
    const badge = document.getElementById('notifCountBadge');
    if (badge) {
      accountUnreadNotificationCount = data.unreadCount || 0;
      const unread = accountUnreadNotificationCount + getSavedFinderConversations().length;
      badge.textContent = unread;
      badge.style.display = unread > 0 ? 'inline-flex' : 'none';
      swayNotificationBellIfNew(unread);
    }
    refreshFinderNotificationsButton();
  } catch (err) {
    if (requestId !== notificationsLoadRequestId) return;
    if (silent) {
      console.error('Could not refresh notifications:', err);
      return;
    }
    document.getElementById('notificationSelectionToolbar').hidden = true;
    list.innerHTML = '<p class="notif-empty">Failed to load notifications.</p>';
  }
}

function selectAllNotifications(checked) {
  document.querySelectorAll('#notificationsList .notification-select').forEach((input) => {
    input.checked = checked;
  });
  updateNotificationSelection();
}

function updateNotificationSelection() {
  const checkboxes = [...document.querySelectorAll('#notificationsList .notification-select')];
  checkboxes.forEach((input) => {
    input.closest('.notif-item')?.classList.toggle('is-selected', input.checked);
  });
  const selectedCount = checkboxes.filter((input) => input.checked).length;
  const selectAll = document.getElementById('selectAllNotifications');
  selectAll.checked = checkboxes.length > 0 && selectedCount === checkboxes.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
  document.getElementById('selectedNotificationCount').textContent = `${selectedCount} selected`;
  document.getElementById('deleteSelectedNotifications').disabled = selectedCount === 0;
  document.getElementById('markSelectedNotificationsRead').disabled = !checkboxes.some(
    (input) => input.checked && input.closest('.notif-item')?.classList.contains('unread')
  );
}

async function markSelectedNotificationsRead() {
  const notificationIds = [...document.querySelectorAll('#notificationsList .notification-select:checked')].map(
    (input) => JSON.parse(input.value)
  );
  if (!notificationIds.length) return;

  const button = document.getElementById('markSelectedNotificationsRead');
  button.disabled = true;
  try {
    const res = await fetch('/api/items/notifications/read', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notificationIds }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Could not mark notifications as read.');
    showToast(`${data.updatedCount} notification${data.updatedCount === 1 ? '' : 's'} marked as read.`);
    await loadNotificationsIntoModal({ silent: true });
    await loadMyNotifications();
  } catch (error) {
    showToast(error.message || 'Could not mark notifications as read.', 'error');
    updateNotificationSelection();
  }
}

async function deleteSelectedNotifications() {
  const notificationIds = [...document.querySelectorAll('#notificationsList .notification-select:checked')].map(
    (input) => JSON.parse(input.value)
  );
  if (!notificationIds.length) return;
  const confirmed = await askConfirm(
    `Delete ${notificationIds.length} selected notification${notificationIds.length === 1 ? '' : 's'}?`,
    { title: 'Delete notifications?', confirmLabel: 'Delete', icon: '🗑️' }
  );
  if (!confirmed) return;

  const button = document.getElementById('deleteSelectedNotifications');
  button.disabled = true;
  try {
    const res = await fetch('/api/items/notifications', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notificationIds }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Could not delete notifications.');
    showToast(`${data.deletedCount} notification${data.deletedCount === 1 ? '' : 's'} deleted.`);
    await loadNotificationsIntoModal({ silent: true });
    await loadMyNotifications();
  } catch (err) {
    button.disabled = false;
    showToast(err.message || 'Could not delete notifications.', 'error');
  }
}

async function deleteRegisteredConversationNotification(notificationId, itemId, button) {
  if (!notificationId || !itemId || button.disabled) return;
  const confirmed = await askConfirm(
    'Delete this QR finder conversation and its notification? This cannot be undone.',
    { title: 'Delete conversation?', confirmLabel: 'Delete', icon: '🗑️' }
  );
  if (!confirmed) return;

  button.disabled = true;
  try {
    const res = await fetch('/api/items/notifications', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notificationIds: [{ kind: 'item', recordId: String(itemId), id: String(notificationId) }],
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Could not delete the conversation.');
    if (!data.deletedCount) throw new Error('The conversation was not found or is no longer available.');
    showToast('Conversation deleted.');
    await loadNotificationsIntoModal({ silent: true });
    await loadMyNotifications();
  } catch (error) {
    button.disabled = false;
    showToast(error.message || 'Could not delete the conversation.', 'error');
  }
}

async function deleteClaimConversationNotification(claimId, button) {
  if (!claimId || button.disabled) return;
  const confirmed = await askConfirm(
    'Remove this claim conversation from your Account Notifications? The other participant will still have access.',
    { title: 'Delete conversation?', confirmLabel: 'Delete', icon: '🗑️' }
  );
  if (!confirmed) return;

  button.disabled = true;
  try {
    const res = await fetch('/api/items/notifications', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notificationIds: [
          {
            kind: 'claim-conversation',
            recordId: String(claimId),
            id: `claim-conversation-${claimId}`,
          },
        ],
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Could not delete the conversation.');
    if (!data.deletedCount) throw new Error('The conversation was not found or is no longer available.');
    showToast('Conversation deleted from your notifications.');
    await loadNotificationsIntoModal({ silent: true });
    await loadMyNotifications();
  } catch (error) {
    button.disabled = false;
    showToast(error.message || 'Could not delete the conversation.', 'error');
  }
}

async function removeSavedFinderConversationFromInbox(conversationId, button) {
  if (!conversationId || button.disabled) return;
  const confirmed = await askConfirm(
    'Remove this saved finder conversation from this browser? The owner will still have the conversation.',
    { title: 'Remove saved conversation?', confirmLabel: 'Remove', icon: '🗑️' }
  );
  if (!confirmed) return;

  button.disabled = true;
  if (!removeSavedFinderConversation(conversationId)) {
    button.disabled = false;
    return;
  }
  showToast('Saved conversation removed from this browser.');
  await loadNotificationsIntoModal({ silent: true });
  await loadMyNotifications();
}

async function markNotifRead(notifId, btn) {
  try {
    const res = await fetch(`/api/items/notifications/${notifId}/read`, { method: 'PATCH' });
    const data = await res.json();
    if (data.success) {
      const item = btn.closest('.notif-item');
      if (item) item.classList.remove('unread');
      btn.remove();
      updateNotificationSelection();
      await loadMyNotifications(); // refresh badge
    }
  } catch (err) {
    showToast('Could not mark as read.', 'error');
  }
}

async function loadMyNotifications() {
  if (!currentUser) {
    refreshFinderNotificationsButton();
    return;
  }
  try {
    const res = await fetch('/api/items/my-notifications');
    if (!res.ok) throw new Error('Notification refresh request failed.');
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Notification refresh failed.');
    const badge = document.getElementById('notifCountBadge');
    if (badge) {
      accountUnreadNotificationCount = data.unreadCount || 0;
      const unread = accountUnreadNotificationCount + getSavedFinderConversations().length;
      badge.textContent = unread;
      badge.style.display = unread > 0 ? 'inline-flex' : 'none';
      swayNotificationBellIfNew(unread);
    }
  } catch (error) {
    console.error('Could not refresh notification count:', error);
  }
}

function swayNotificationBellIfNew(unreadCount) {
  if (lastDisplayedUnreadNotificationCount !== null && unreadCount > lastDisplayedUnreadNotificationCount) {
    document.querySelectorAll('.notif-bell-btn:not(#finderNotificationsBtn) svg').forEach((icon) => {
      icon.classList.remove('is-swaying');
      void icon.getBoundingClientRect();
      icon.classList.add('is-swaying');
    });
    const badge = document.getElementById('notifCountBadge');
    if (badge) {
      badge.classList.remove('is-bumped');
      void badge.offsetWidth;
      badge.classList.add('is-bumped');
    }
  }
  lastDisplayedUnreadNotificationCount = unreadCount;
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
document.addEventListener(
  'load',
  (event) => {
    if (event.target.matches?.('img[data-item-photo]')) setItemPhotoState(event.target, 'loaded');
  },
  true
);
document.addEventListener(
  'error',
  (event) => {
    if (event.target.matches?.('img[data-item-photo]')) setItemPhotoState(event.target, 'error');
  },
  true
);

// ── Photo viewer (css/lightbox.css) ────────────────────────────────────────
// Opening a card's photo shows it full screen with the item's details. The other
// photos on the current page can be browsed with the arrows, ← / → or a swipe.
let lightboxPhotos = [];
let lightboxIndex = 0;

// Every card photo on the page that can be opened, in the order shown.
function collectLightboxPhotos() {
  return [...document.querySelectorAll('#itemsGrid .item-photo-frame[data-action="openImageModal"]')]
    .map((frame) => {
      let src = '';
      let title = '';
      try {
        [src, title] = JSON.parse(frame.dataset.args);
      } catch {
        /* skip malformed */
      }
      const cardId = frame.closest('[id^="item-card-"]')?.id.replace('item-card-', '');
      const item = loadedItems.find((entry) => String(entry.id) === cardId);
      return { src, title, item };
    })
    .filter((photo) => photo.src);
}

function openImageModal(photoSrc, title) {
  if (!photoSrc) return;
  lightboxPhotos = collectLightboxPhotos();
  lightboxIndex = lightboxPhotos.findIndex((photo) => photo.src === photoSrc);
  if (lightboxIndex === -1) {
    lightboxPhotos = [{ src: photoSrc, title }];
    lightboxIndex = 0;
  }
  const box = document.querySelector('#imageModal .lightbox');
  box.classList.remove('is-next', 'is-prev');
  showLightboxPhoto();
  document.getElementById('imageModal').classList.add('open');
}

function showLightboxPhoto(direction = 0) {
  const photo = lightboxPhotos[lightboxIndex];
  const box = document.querySelector('#imageModal .lightbox');
  const image = document.getElementById('imageModalImg');
  const fallback = document.getElementById('imageModalFallback');
  setImageZoom(false);

  box.classList.add('is-loading');
  image.hidden = false;
  fallback.hidden = true;
  image.onload = () => box.classList.remove('is-loading');
  image.onerror = () => {
    box.classList.remove('is-loading');
    image.hidden = true;
    fallback.hidden = false;
  };
  image.alt = photo.title ? `Photo of ${photo.title}` : 'Item photo';
  image.src = photo.src;
  if (image.complete && image.naturalWidth) box.classList.remove('is-loading');

  // Slide in from the side the photo came from.
  box.classList.remove('is-next', 'is-prev');
  if (direction) {
    void box.offsetWidth;
    box.classList.add(direction > 0 ? 'is-next' : 'is-prev');
  }

  renderLightboxCaption(photo);
  const total = lightboxPhotos.length;
  document.getElementById('imageModalCounter').textContent = total > 1 ? `${lightboxIndex + 1} / ${total}` : '';
  document.getElementById('imageModalPrev').hidden = total < 2;
  document.getElementById('imageModalNext').hidden = total < 2;
  document.getElementById('imageModalOpen').href = photo.src;

  // Load the neighbours now so the next arrow press is instant.
  [lightboxIndex - 1, lightboxIndex + 1].forEach((index) => {
    const neighbour = lightboxPhotos[(index + total) % total];
    if (neighbour && total > 1) new Image().src = neighbour.src;
  });
}

function renderLightboxCaption(photo) {
  const item = photo.item;
  document.getElementById('imageModalTitle').textContent = item?.title || photo.title || 'Item photo';

  const badge = document.getElementById('imageModalBadge');
  if (item) {
    const status = item.claimed ? 'claimed' : item.type === 'lost' ? 'lost' : 'found';
    badge.className = `item-badge badge-${status}`;
    badge.textContent = status[0].toUpperCase() + status.slice(1);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }

  const meta = document.getElementById('imageModalMeta');
  meta.replaceChildren();
  if (!item) return;
  const reported = item.createdAt || item.date ? new Date(item.createdAt || item.date) : null;
  const parts = [
    [item.category, ''],
    [item.location, ''],
    [reported && !Number.isNaN(reported.getTime()) ? `Reported ${relativeTimeLabel(reported)}` : '', ''],
    [item.refCode, 'lightbox-ref'],
  ];
  parts
    .filter(([text]) => text)
    .forEach(([text, className]) => {
      const span = document.createElement('span');
      span.textContent = text;
      if (className) span.className = className;
      meta.appendChild(span);
    });
}

function showAdjacentPhoto(step) {
  const total = lightboxPhotos.length;
  if (total < 2) return;
  lightboxIndex = (lightboxIndex + step + total) % total;
  showLightboxPhoto(step);
}

// Zoom in around a point of the photo (fractions 0-1), or out.
function setImageZoom(zoomed, originX = 0.5, originY = 0.5) {
  const box = document.querySelector('#imageModal .lightbox');
  const image = document.getElementById('imageModalImg');
  box.classList.toggle('is-zoomed', zoomed);
  image.style.transformOrigin = `${originX * 100}% ${originY * 100}%`;
  const button = document.getElementById('imageModalZoom');
  button.setAttribute('aria-label', zoomed ? 'Zoom out' : 'Zoom in');
  button.setAttribute('aria-pressed', String(zoomed));
}

function toggleImageZoom() {
  const zoomed = document.querySelector('#imageModal .lightbox').classList.contains('is-zoomed');
  setImageZoom(!zoomed);
}

function closeImageModal() {
  setImageZoom(false);
  document.getElementById('imageModal').classList.remove('open');
}

function setupPhotoLightbox() {
  const modal = document.getElementById('imageModal');
  const stage = document.getElementById('imageModalStage');
  const image = document.getElementById('imageModalImg');
  if (!modal || !stage || !image) return;
  const box = modal.querySelector('.lightbox');
  const pointFraction = (event) => {
    const rect = image.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    ];
  };

  // Click the photo to zoom in where you clicked; click again to zoom out.
  image.addEventListener('click', (event) => {
    if (swipeHandled) return;
    const zoomed = box.classList.contains('is-zoomed');
    setImageZoom(!zoomed, ...pointFraction(event));
  });
  // While zoomed, the visible part follows the pointer.
  image.addEventListener('pointermove', (event) => {
    if (!box.classList.contains('is-zoomed') || event.pointerType === 'touch') return;
    const [x, y] = pointFraction(event);
    image.style.transformOrigin = `${x * 100}% ${y * 100}%`;
  });

  // Clicking the dark area around the photo closes the viewer.
  stage.addEventListener('click', (event) => {
    if (event.target === stage || event.target.id === 'imageModalFrame') closeImageModal();
  });

  // Swipe left / right on touch screens.
  let swipeStart = null;
  let swipeHandled = false;
  stage.addEventListener('pointerdown', (event) => {
    swipeHandled = false;
    swipeStart =
      event.pointerType === 'touch' && !box.classList.contains('is-zoomed')
        ? { x: event.clientX, y: event.clientY }
        : null;
  });
  stage.addEventListener('pointerup', (event) => {
    if (!swipeStart) return;
    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swipeHandled = true;
      showAdjacentPhoto(dx < 0 ? 1 : -1);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (!modal.classList.contains('open')) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      showAdjacentPhoto(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      showAdjacentPhoto(-1);
    }
  });
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
  area.addEventListener('dragover', (event) => {
    event.preventDefault();
    area.classList.add('dragover');
  });
  area.addEventListener('dragleave', () => area.classList.remove('dragover'));
  area.addEventListener('drop', handlePhotoDrop);
}

function setupItemLocationSuggestions() {
  const input = document.getElementById('itemLocation');
  const suggestions = document.getElementById('itemLocationSuggestions');
  const datalist = document.getElementById('itemLocationOptions');
  const wrapper = input?.closest('.location-input-wrap');
  if (!input || !suggestions || !datalist || !wrapper) return;

  const locations = [...datalist.options].map((option) => option.value).filter(Boolean);
  let visibleLocations = [];
  let activeIndex = -1;

  const closeSuggestions = () => {
    suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  };

  const renderSuggestions = () => {
    const query = input.value.trim().toLocaleLowerCase();
    visibleLocations = locations.filter((location) => location.toLocaleLowerCase().includes(query));
    activeIndex = -1;
    suggestions.replaceChildren();

    if (!visibleLocations.length) {
      closeSuggestions();
      return;
    }

    visibleLocations.forEach((location, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.id = `itemLocationOption${index}`;
      option.className = 'location-suggestion';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.tabIndex = -1;
      option.dataset.location = location;
      option.textContent = location;
      suggestions.append(option);
    });

    suggestions.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  const setActiveOption = (index) => {
    if (!visibleLocations.length) return;
    activeIndex = (index + visibleLocations.length) % visibleLocations.length;
    const options = suggestions.querySelectorAll('[role="option"]');
    options.forEach((option, optionIndex) => {
      const active = optionIndex === activeIndex;
      option.setAttribute('aria-selected', String(active));
      option.classList.toggle('is-active', active);
    });
    const activeOption = options[activeIndex];
    input.setAttribute('aria-activedescendant', activeOption.id);
    activeOption.scrollIntoView({ block: 'nearest' });
  };

  const selectLocation = (location) => {
    input.value = location;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    closeSuggestions();
  };

  input.addEventListener('focus', renderSuggestions);
  input.addEventListener('click', () => {
    if (suggestions.hidden) renderSuggestions();
  });
  input.addEventListener('input', renderSuggestions);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (suggestions.hidden) renderSuggestions();
      if (suggestions.hidden) return;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const start = activeIndex < 0 ? (direction > 0 ? -1 : 0) : activeIndex;
      setActiveOption(start + direction);
    } else if (event.key === 'Enter' && !suggestions.hidden && activeIndex >= 0) {
      event.preventDefault();
      selectLocation(visibleLocations[activeIndex]);
    } else if (event.key === 'Escape' && !suggestions.hidden) {
      event.preventDefault();
      closeSuggestions();
    } else if (event.key === 'Tab') {
      closeSuggestions();
    }
  });

  suggestions.addEventListener('mousedown', (event) => {
    if (event.target.closest('[role="option"]')) event.preventDefault();
  });
  suggestions.addEventListener('click', (event) => {
    const option = event.target.closest('[role="option"]');
    if (option && suggestions.contains(option)) selectLocation(option.dataset.location);
  });
  input.addEventListener('blur', () => {
    window.setTimeout(closeSuggestions, 120);
  });
  document.addEventListener('click', (event) => {
    if (!wrapper.contains(event.target)) closeSuggestions();
  });
}

// The optional fields fold away again whenever the form is cleared (Cancel or after submitting).
function setupReportMoreDetails() {
  const form = document.getElementById('itemForm');
  const more = document.getElementById('reportMoreDetails');
  if (!form || !more) return;
  form.addEventListener('reset', () => {
    more.open = false;
  });
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
  setManualReportFormOpen(false);
}

// The report form starts folded away behind "Prefer to type it in yourself?" so the
// assistant is the only thing competing for attention; the assistant itself calls
// openManualReportForm() once it has something to show, instead of toggling.
function setManualReportFormOpen(open) {
  const card = document.getElementById('manualReportCard');
  const toggle = document.getElementById('manualReportToggle');
  if (!card || !toggle) return;
  card.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.classList.toggle('is-open', open);
}

function toggleManualReportForm() {
  const card = document.getElementById('manualReportCard');
  setManualReportFormOpen(Boolean(card && card.hidden));
}

function openManualReportForm() {
  setManualReportFormOpen(true);
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
  const form = document.getElementById('itemForm');
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
    form.setAttribute('aria-busy', 'true');
    const res = await fetch('/api/items', {
      method: 'POST',
      headers: { 'Idempotency-Key': reportSubmissionKey },
      body: payload,
    });

    const data = await res.json();
    if (data.success) {
      rotateReportSubmissionKey();
      document.getElementById('itemForm').reset();
      removePhoto();
      updateTypeRadio();
      setManualReportFormOpen(false);
      if (typeof window.assistantReset === 'function') window.assistantReset();
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
      const message =
        Array.isArray(data.errors) && data.errors.length ? data.errors.join(' ') : data.message || 'Validation error';
      showToast(message, true);
    }
  } catch (err) {
    showToast('Network error while saving report.', true);
  } finally {
    form.removeAttribute('aria-busy');
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
  const item = loadedItems.find((i) => String(i.id) === String(id));
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
  const item = loadedItems.find((i) => String(i.id) === String(id));
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
      body: JSON.stringify({ proof }),
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
  return String(str).replace(
    /[&<>'"]/g,
    (tag) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[tag] || tag
  );
}

// Renders a contact string as a clickable tel:/mailto: link when it looks like one, plain text otherwise.
function contactLinkHtml(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return `<a href="mailto:${escapeHtml(text)}">${escapeHtml(text)}</a>`;
  if (/^[+\d][\d\s().-]{6,}$/.test(text))
    return `<a href="tel:${escapeHtml(text.replace(/[^\d+]/g, ''))}">${escapeHtml(text)}</a>`;
  return escapeHtml(text);
}

// ── Generic confirmation modal (replaces window.confirm(), which shows the
// browser's own "this site says" chrome instead of the app's own styling) ──
let genericConfirmResolve = null;
let confirmItemReturnedResolve = null;

function askConfirmItemReturned(isRegisteredConversation = false) {
  document.getElementById('confirmItemReturnedTitle').textContent = isRegisteredConversation
    ? 'Confirm item returned?'
    : 'Confirm item received/returned?';
  document.getElementById('confirmItemReturnedText').textContent = isRegisteredConversation
    ? 'Confirm that the registered belonging has been returned to its owner? The conversation closes only after both people confirm.'
    : 'Confirm that this item has been received or returned? Once both sides confirm, the item is marked as claimed.';
  document.getElementById('confirmItemReturnedButton').textContent = isRegisteredConversation
    ? 'Confirm return'
    : 'Confirm';
  document.getElementById('confirmItemReturnedModal').classList.add('open');
  return new Promise((resolve) => {
    confirmItemReturnedResolve = resolve;
  });
}

function closeConfirmItemReturned() {
  document.getElementById('confirmItemReturnedModal').classList.remove('open');
  if (confirmItemReturnedResolve) {
    const resolve = confirmItemReturnedResolve;
    confirmItemReturnedResolve = null;
    resolve(false);
  }
}

function confirmItemReturned() {
  document.getElementById('confirmItemReturnedModal').classList.remove('open');
  if (confirmItemReturnedResolve) {
    const resolve = confirmItemReturnedResolve;
    confirmItemReturnedResolve = null;
    resolve(true);
  }
}

function askConfirm(text, { title = 'Are you sure?', confirmLabel = 'Confirm', icon = '⚠️' } = {}) {
  document.getElementById('genericConfirmTitle').textContent = title;
  document.getElementById('genericConfirmText').textContent = text;
  document.getElementById('genericConfirmIcon').textContent = icon;
  document.getElementById('genericConfirmBtn').textContent = confirmLabel;
  document.getElementById('genericConfirmModal').classList.add('open');
  return new Promise((resolve) => {
    genericConfirmResolve = resolve;
  });
}

function closeGenericConfirm() {
  document.getElementById('genericConfirmModal').classList.remove('open');
  if (genericConfirmResolve) {
    const resolve = genericConfirmResolve;
    genericConfirmResolve = null;
    resolve(false);
  }
}

function confirmGenericConfirm() {
  document.getElementById('genericConfirmModal').classList.remove('open');
  if (genericConfirmResolve) {
    const resolve = genericConfirmResolve;
    genericConfirmResolve = null;
    resolve(true);
  }
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

// Theme toggle: toggleTheme() lives in js/main.js (circular reveal, rapid-click safe).

function updateThemeIcon() {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  document.querySelectorAll('.theme-toggle').forEach((btn) => {
    btn.innerHTML = themeToggleIconHtml(theme);
    btn.setAttribute('title', theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode');
    btn.setAttribute('aria-label', theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode');
  });
}

function loadTheme() {
  document.documentElement.setAttribute('data-theme', resolveTheme()); // js/main.js: device setting or manual choice
  updateThemeIcon();
}

// Initial load
document.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  setupPhotoDropZone();
  setupItemLocationSuggestions();
  setupReportMoreDetails();
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('click', () => searchInput.select());
  ['deleteAccountPassword', 'deleteAccountConfirm'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', updateDeleteAccountButton);
  });
  setupReportPanelSticky();
  setupPhotoLightbox();
  const matchParams = new URLSearchParams(window.location.search);
  checkAuthSession().then(() => {
    // Deep links from other pages' account menu (e.g. about.html, whose markup has no
    // notifications/change-password modal of its own): land here and open the real one.
    const action = matchParams.get('action');
    if (action === 'register-belonging') {
      window.history.replaceState(window.history.state, '', '/');
      handleOpenRegisterBelonging();
    } else if (action === 'view-notifications') {
      window.history.replaceState(window.history.state, '', '/');
      openNotificationsModal();
    } else if (action === 'change-password') {
      window.history.replaceState(window.history.state, '', '/');
      openChangePasswordModal();
    } else if (action === 'keyboard-shortcuts') {
      window.history.replaceState(window.history.state, '', '/index.html');
      openKeyboardShortcutsModal();
    }
  });
  fetchStats();
  window.notificationBadgeTimer = window.setInterval(() => {
    const notificationsModal = document.getElementById('notificationsModal');
    if (
      document.visibilityState === 'visible' &&
      !notificationsModal?.classList.contains('open')
    ) {
      loadMyNotifications();
    }
  }, 30000);
  openMatchReferenceFromQr(matchParams.get('token'));
  const finderRef = window.location.pathname === '/found' ? matchParams.get('ref') : null;
  const finderConversation = getFinderConversationLink();
  if (finderConversation) openRegisteredFinderConversation(finderConversation.id, finderConversation.token);
  else if (finderRef) openAnonymousFinderModal(finderRef);
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
    links.querySelectorAll('a, button').forEach((el) => {
      el.addEventListener('click', () => links.classList.remove('open'));
    });
  }
});

let deleteTargetId = null;
    let activeTab = 'items';
    let adminItems = [];
    let claimRequests = [];
    let adminClaimsSignature = null;
    let activeClaimReviewId = null;
    let adminRefreshInProgress = false;
    let adminItemsSignature = null;
    let actionConfirmResolver = null;
    let cachedServerItems = [];
    const selectedItemIds = new Set();
    let adminSort = { key: 'date', direction: 'desc' };
    const adminItemsPerPage = 10;
    let adminCurrentPage = 1;
    let adminUsers = [];
    let deleteUserTargetId = null;

    async function adminFetch(url, options = {}) {
      const response = await fetch(url, { ...options, credentials: 'same-origin' });
      if (response.status === 401 || response.status === 403) {
        window.location.replace('/login?redirect=%2Fadmin.html');
      }
      return response;
    }

    async function requireAdminSession() {
      try {
        const response = await adminFetch('/api/auth/me', { cache: 'no-store' });
        if (!response.ok) return response.status >= 500;
        const data = await response.json();
        if (response.ok && data.authenticated && data.user?.role === 'admin') {
          window.currentAdminUserId = data.user.id;
          installDashboardBackGuard();
          return true;
        }
      } catch (error) {
        return true;
      }
      window.location.replace('/login?redirect=%2Fadmin.html');
      return false;
    }

    document.addEventListener('DOMContentLoaded', async () => {
      initNav();
      if (!await requireAdminSession()) return;
      refreshAdminItems();
      refreshAdminClaims();
      refreshAdminUsers();
      window.setInterval(() => {
        refreshAdminItems();
        refreshAdminClaims();
      }, 5000);

      document.querySelectorAll('[data-admin-filter]').forEach(link => {
        link.addEventListener('click', event => {
          event.preventDefault();
          showAdminItems(link.dataset.adminFilter);
        });
      });

    // Tabs
      document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          activeTab = tab.dataset.tab;
          document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          document.getElementById('tabItems').style.display = activeTab === 'items' ? 'block' : 'none';
          document.getElementById('tabClaims').style.display = activeTab === 'claims' ? 'block' : 'none';
          document.getElementById('tabUsers').style.display = activeTab === 'users' ? 'block' : 'none';
          if (activeTab === 'claims') renderPendingClaims();
          if (activeTab === 'users') renderAdminUsers();
        });
      });

      // Delete modal controls
      document.getElementById('cancelDelete').addEventListener('click',  closeDeleteModal);
      document.getElementById('confirmDelete').addEventListener('click', doDelete);
      document.getElementById('deleteModal').addEventListener('click', e => {
        if (e.target === document.getElementById('deleteModal')) closeDeleteModal();
      });

      // Export CSV
      document.getElementById('exportBtn').addEventListener('click', exportCSV);
      document.getElementById('bulkClaimBtn').addEventListener('click', () => runBulkAction('claim'));
      document.getElementById('bulkArchiveBtn').addEventListener('click', () => runBulkAction('archive'));
      document.getElementById('bulkDeleteBtn').addEventListener('click', () => runBulkAction('delete'));
      document.getElementById('exportSelectedBtn').addEventListener('click', () => exportCSV([...selectedItemIds]));
      document.getElementById('refreshClaimsBtn').addEventListener('click', refreshAdminClaims);
      document.getElementById('sendBroadcastBtn').addEventListener('click', sendBroadcast);
      document.getElementById('cancelActionConfirm').addEventListener('click', closeActionConfirm);
      document.getElementById('actionConfirmModal').addEventListener('click', event => { if (event.target.id === 'actionConfirmModal') closeActionConfirm(); });
      document.getElementById('openCreateUserBtn').addEventListener('click', () => { document.getElementById('userFormPanel').hidden = false; });
      document.getElementById('cancelCreateUserBtn').addEventListener('click', closeCreateUserForm);
      document.getElementById('createUserForm').addEventListener('submit', createAdminUser);
      document.querySelector('#createUserForm [name="role"]').addEventListener('change', event => {
        const department = document.querySelector('#createUserForm [name="department"]');
        if (event.target.value === 'admin') department.value = 'Administration';
        else if (department.value === 'Administration') department.value = '';
      });
      document.getElementById('confirmDeleteUser').addEventListener('click', deleteAdminUser);
      document.getElementById('cancelDeleteUser').addEventListener('click', closeDeleteUserModal);
      document.getElementById('deleteUserModal').addEventListener('click', event => { if (event.target.id === 'deleteUserModal') closeDeleteUserModal(); });
      document.getElementById('selectAllItems').addEventListener('change', toggleSelectAllVisible);
      document.getElementById('adminFilterDate').addEventListener('change', () => { adminCurrentPage = 1; renderItemsTable(); });
      document.querySelectorAll('.sort-button').forEach(button => button.addEventListener('click', () => {
        const key = button.dataset.sort;
        adminSort = adminSort.key === key
          ? { key, direction: adminSort.direction === 'asc' ? 'desc' : 'asc' }
          : { key, direction: 'asc' };
        renderItemsTable();
      }));

      // Reactive admin filters
      ['adminSearch','adminFilterType','adminFilterStatus'].forEach(id => {
        document.getElementById(id).addEventListener('input', () => {
          adminCurrentPage = 1;
          renderItemsTable();
        });
      });
      updateBulkToolbar();
    });

    async function refreshAdminUsers() {
      try {
        const response = await adminFetch('/api/auth/users', { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        adminUsers = Array.isArray(data.users) ? data.users : [];
        renderAdminUsers();
      } catch (error) {
        showToast('Could not load users.', 'error');
      }
    }

    function renderAdminUsers() {
      const body = document.getElementById('adminUsersBody');
      const empty = document.getElementById('adminUsersEmptyState');
      if (!body) return;
      empty.hidden = adminUsers.length > 0;
      body.innerHTML = adminUsers.map(user => `
        <tr>
          <td>${escHtml(user.fullName || '—')}</td>
          <td>${escHtml(user.email || '—')}</td>
          <td><span class="badge">${escHtml(user.role || 'student')}</span></td>
          <td>${escHtml(user.department || '—')}</td>
          <td>${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}</td>
          <td><button type="button" class="action-btn action-btn-delete user-delete-button" data-user-id="${escHtml(user.id)}" data-user-name="${escHtml(user.fullName || user.email)}"${user.id === window.currentAdminUserId ? ' disabled' : ''}>Delete</button></td>
        </tr>`).join('');
      body.querySelectorAll('.user-delete-button').forEach(button => button.addEventListener('click', () => openDeleteUserModal(button.dataset.userId, button.dataset.userName)));
    }

    function closeCreateUserForm() {
      const form = document.getElementById('createUserForm');
      form.reset();
      form.elements.studentId.value = 'N/A';
      document.getElementById('userFormPanel').hidden = true;
    }

    async function createAdminUser(event) {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        const response = await adminFetch('/api/auth/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.errors?.join(' ') || data.message || 'Could not create user.');
        closeCreateUserForm();
        await refreshAdminUsers();
        showToast('User created successfully.');
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        submit.disabled = false;
      }
    }

    function openDeleteUserModal(id, name) {
      deleteUserTargetId = id;
      document.getElementById('deleteUserMsg').textContent = `Are you sure you want to permanently delete ${name}? This action cannot be undone.`;
      document.getElementById('deleteUserModal').classList.add('open');
    }

    function closeDeleteUserModal() {
      deleteUserTargetId = null;
      document.getElementById('deleteUserModal').classList.remove('open');
    }

    async function deleteAdminUser() {
      if (!deleteUserTargetId) return;
      const button = document.getElementById('confirmDeleteUser');
      button.disabled = true;
      try {
        const response = await adminFetch(`/api/auth/users/${encodeURIComponent(deleteUserTargetId)}`, { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Could not delete user.');
        closeDeleteUserModal();
        await refreshAdminUsers();
        showToast('User deleted successfully.');
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    }

    function normalizeAdminItem(item) {
      const normalized = { ...item };
      normalized.status = item.status || item.type || 'pending';
      normalized.desc = item.desc || item.description || '';
      normalized.description = item.description || item.desc || '';
      normalized.reporterName = item.reporterName || '';
      normalized.reporterContact = item.reporterContact || item.contact || item.reporterEmail || '';
      normalized.dateLost = item.dateLost || (item.type === 'lost' ? item.date || item.createdAt : '');
      normalized.dateFound = item.dateFound || (item.type === 'found' ? item.date || item.createdAt : '');
      return normalized;
    }

    async function refreshAdminItems() {
      if (adminRefreshInProgress) return;
      adminRefreshInProgress = true;
      try {
        try {
          const response = await adminFetch('/api/items', { cache: 'no-store' });
          if (response.ok) {
            const data = await response.json();
            if (data.success && Array.isArray(data.items)) {
              cachedServerItems = data.items
                .filter(item => item.type !== 'registered')
                .map(normalizeAdminItem);
            }
          }
        } catch (error) {
          // Keep the last server snapshot when the API is temporarily unavailable.
        }
        const nextItems = [...cachedServerItems];
        const nextSignature = JSON.stringify(nextItems);
        if (nextSignature !== adminItemsSignature) {
          adminItemsSignature = nextSignature;
          adminItems = nextItems;
          renderAdminPanel(adminItems);
        }
      } finally {
        adminRefreshInProgress = false;
      }
    }

    async function refreshAdminClaims() {
      try {
        const response = await adminFetch('/api/items/claims', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok || !data.success) return;
        const nextSignature = JSON.stringify(data.claims);
        if (nextSignature === adminClaimsSignature) return;
        adminClaimsSignature = nextSignature;
        claimRequests = data.claims;
        document.getElementById('pendingClaimsTabCount').textContent = claimRequests.filter(claim => claim.status === 'pending').length;
        renderAdminPanel(adminItems);
        renderItemsTable();
        renderPendingClaims();
      } catch (error) {
        // Keep the last claim snapshot when the API is temporarily unavailable.
      }
    }

    function renderAdminPanel(items = adminItems) {
      adminItems = items;
      const lost    = items.filter(i => i.type==='lost').length;
      const found   = items.filter(i => i.type==='found').length;
      const claimed = items.filter(i => i.status==='claimed').length;
      const pendingClaims = claimRequests.filter(claim => claim.status === 'pending');
      const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const staleActive = items.filter(i => i.status !== 'claimed' && new Date(i.createdAt || i.date).getTime() < threshold).length;
      const pending = pendingClaims.length + staleActive;
      document.getElementById('adminStats').innerHTML = `
        <div class="stat-card"><div class="stat-number">${items.length}</div><div class="stat-label">Total Items</div></div>
        <div class="stat-card"><div class="stat-number">${lost}</div><div class="stat-label">Lost</div></div>
        <div class="stat-card"><div class="stat-number">${found}</div><div class="stat-label">Found</div></div>
        <div class="stat-card"><div class="stat-number">${claimed}</div><div class="stat-label">Claimed</div></div>
        <div class="stat-card"><div class="stat-number">${staleActive}</div><div class="stat-label">Unresolved</div></div>
        <div class="stat-card"><div class="stat-number">${pendingClaims.length}</div><div class="stat-label">Pending Claims</div></div>
        <div class="stat-card action-needed-card"><div class="stat-number">${pending}</div><div class="stat-label">Action Needed</div></div>
      `;

      renderAdminInsights(items);

      renderItemsTable();
      renderPendingClaims();
    }

    function renderPendingClaims() {
      const container = document.getElementById('pendingClaimsList');
      if (!container) return;
      const pending = claimRequests.filter(claim => claim.status === 'pending');
      if (!pending.length) {
        container.innerHTML = '<div class="empty-state"><h3>No pending claims</h3><p>New student claim requests will appear here.</p></div>';
        return;
      }
      container.innerHTML = pending.map(claim => {
        const item = adminItems.find(entry => String(entry.id) === String(claim.itemId));
        return `<article class="pending-claim-card">
          <div><span class="claim-status-pending">PENDING REVIEW</span><h3>${escHtml(item?.title || claim.itemTitle || 'Unknown item')}</h3><p>${escHtml(item?.refCode || claim.itemRefCode || '')}</p></div>
          <div class="pending-claim-details"><strong>${escHtml(claim.claimantName || 'Unknown student')}</strong><span>Student ID: ${escHtml(claim.claimantStudentId || 'Not provided')}</span><span>${escHtml(claim.claimantDepartment || 'Department not provided')} · ${escHtml(claim.claimantCourseYear || 'Course not provided')}</span><span>Submitted ${formatDate(claim.createdAt)}</span></div>
          <div class="pending-claim-proof"><strong>Ownership proof</strong><p>${escHtml(claim.proof || 'No proof submitted.')}</p></div>
          <button class="action-btn action-btn-claim" onclick="openClaimReview('${escHtml(claim.id)}')">Review Claim</button>
        </article>`;
      }).join('');
    }

    function renderAdminInsights(items) {
      const categories = countValues(items, 'category').slice(0, 5);
      const locations = countValues(items, 'location').slice(0, 5);
      const chart = (title, values) => `<div class="insight-card"><h3>${title}</h3>${values.length ? values.map(([label, count]) => `<div class="bar-row"><span>${escHtml(label || 'Unknown')}</span><div class="bar-track"><i style="width:${Math.max(8, count / Math.max(...values.map(v => v[1])) * 100)}%"></i></div><b>${count}</b></div>`).join('') : '<p>No data yet.</p>'}</div>`;
      document.getElementById('adminInsights').innerHTML = chart('Top Categories', categories) + chart('Top Locations', locations);
    }

    function countValues(items, key) {
      const counts = new Map();
      items.forEach(item => counts.set(item[key] || 'Unknown', (counts.get(item[key] || 'Unknown') || 0) + 1));
      return [...counts.entries()].sort((a, b) => b[1] - a[1]);
    }

    function showAdminItems(type) {
      if (activeTab !== 'items') document.querySelector('.admin-tab[data-tab="items"]').click();
      const typeSelect = document.getElementById('adminFilterType');
      typeSelect.value = type || '';
      syncButtonSelect(typeSelect);
      adminCurrentPage = 1;
      renderItemsTable();
      document.getElementById('tabItems').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function openAdminLogoutModal() {
      document.getElementById('adminLogoutModal').classList.add('open');
    }

    function closeAdminLogoutModal() {
      document.getElementById('adminLogoutModal').classList.remove('open');
    }

    async function confirmAdminLogout() {
      const button = document.getElementById('confirmAdminLogoutBtn');
      button.disabled = true;
      try {
        const response = await adminFetch('/api/auth/logout', {
          method: 'POST',
        });
        if (!response.ok) throw new Error('Logout request failed.');
        window.location.href = '/login';
      } catch (error) {
        button.disabled = false;
        showToast('Unable to log out. Please try again.', 'error');
      }
    }

    function renderItemsTable() {
      let items = getFilteredAdminItems();

      items.sort((a, b) => {
        const left = ['status', 'category'].includes(adminSort.key) ? (a[adminSort.key] || '') : new Date(a.createdAt || a.date).getTime();
        const right = ['status', 'category'].includes(adminSort.key) ? (b[adminSort.key] || '') : new Date(b.createdAt || b.date).getTime();
        const comparison = typeof left === 'string' ? left.localeCompare(right) : left - right;
        return adminSort.direction === 'asc' ? comparison : -comparison;
      });

      const tbody = document.getElementById('adminTableBody');
      const empty = document.getElementById('adminEmptyState');
      const totalItems = items.length;
      const totalPages = Math.ceil(totalItems / adminItemsPerPage);
      adminCurrentPage = totalPages ? Math.min(adminCurrentPage, totalPages) : 1;
      const startIndex = (adminCurrentPage - 1) * adminItemsPerPage;
      const pageItems = items.slice(startIndex, startIndex + adminItemsPerPage);
      renderItemsPagination(totalItems, totalPages, startIndex);

      if (totalItems === 0) {
        tbody.innerHTML = '';
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';

      tbody.innerHTML = pageItems.map((item, idx) => {
        const date = item.type === 'lost' ? formatDate(item.dateLost) : formatDate(item.dateFound);
        const canClaim   = item.status !== 'claimed' && item.status !== 'archived';
        const canRestore = item.status === 'claimed' || item.status === 'archived';
        const itemClaims = claimRequests.filter(claim => String(claim.itemId) === String(item.id));
        const pendingClaim = itemClaims.find(claim => claim.status === 'pending');
        const latestClaim = itemClaims[0];
        const itemStatus = item.status === 'archived'
          ? '<span class="badge badge-archived">Archived</span>'
          : item.claimed || item.status === 'claimed'
          ? '<span class="badge badge-claimed">Claimed</span>'
          : pendingClaim
            ? '<span class="badge admin-status-pending">Pending Verification</span>'
            : latestClaim?.status === 'rejected'
              ? '<span class="badge admin-status-rejected">Rejected · Available</span>'
              : statusBadge(item.status);
            const reporterValues = [...new Set([item.reporterName, item.reporterContact].filter(value => value && value !== '—'))];
        const rowNumber = startIndex + idx + 1;
        return `
        <tr>
          <td title="${rowNumber}"><input class="item-select" type="checkbox" data-item-id="${escHtml(item.id)}" ${selectedItemIds.has(String(item.id)) ? 'checked' : ''} aria-label="Select ${escHtml(item.title)}" /> ${rowNumber}</td>
          <td class="td-title" title="${escHtml(item.title)}">
            <a href="item-detail.html?id=${encodeURIComponent(item.id)}" target="_blank" title="${escHtml(item.title)}">${escHtml(item.title)}</a>
          </td>
          <td title="${escHtml(item.type)}"><span class="badge ${item.type === 'lost' ? 'badge-lost' : 'badge-found'}">${escHtml(item.type)}</span></td>
          <td title="${escHtml(item.category)}">${escHtml(item.category)}</td>
          <td title="${escHtml(item.location)}"><span class="admin-cell-truncate">${escHtml(item.location)}</span></td>
          <td title="${escHtml(reporterValues.join(' · ') || '—')}">${reporterValues.length
            ? reporterValues.map((value, index) => `<span class="admin-cell-truncate${index ? ' reporter-contact' : ''}">${escHtml(value)}</span>`).join('')
            : '—'}</td>
          <td title="${escHtml(date)}">${date}</td>
          <td class="status-cell" title="${pendingClaim ? 'Pending Verification' : latestClaim?.status === 'rejected' && !item.claimed ? 'Rejected · Available' : escHtml(item.status)}">${itemStatus}</td>
          <td class="actions-cell">
            <div class="action-buttons">
              ${pendingClaim ? `<button class="action-btn action-btn-claim" onclick="openClaimReview('${pendingClaim.id}')">Review Claim</button>` : ''}
              ${canRestore ? `<button class="action-btn action-btn-restore" onclick="markRestore('${item.id}','${item.status}')">Restore</button>` : ''}
              <button class="action-btn action-btn-delete" onclick="openDeleteModal('${item.id}','${escHtml(item.title)}','${escHtml(reporterValues[0] || 'Unknown reporter')}')">Delete</button>
            </div>
          </td>
        </tr>`;
      }).join('');
      tbody.querySelectorAll('.item-select').forEach(input => input.addEventListener('change', () => {
        const id = String(input.dataset.itemId);
        if (input.checked) selectedItemIds.add(id); else selectedItemIds.delete(id);
        updateBulkToolbar();
      }));
      updateBulkToolbar();
    }

    function getFilteredAdminItems() {
      let items = adminItems.slice();
      const query = document.getElementById('adminSearch').value.toLowerCase().trim();
      const type = document.getElementById('adminFilterType').value;
      const status = document.getElementById('adminFilterStatus').value;
      const dateRange = document.getElementById('adminFilterDate').value;

      if (query) items = items.filter(item =>
        (item.title || '').toLowerCase().includes(query) ||
        (item.reporterName || '').toLowerCase().includes(query) ||
        (item.reporterContact || '').toLowerCase().includes(query) ||
        (item.reporterEmail || '').toLowerCase().includes(query) ||
        (item.category || '').toLowerCase().includes(query) ||
        (item.location || '').toLowerCase().includes(query) ||
        (item.desc || '').toLowerCase().includes(query)
      );
      if (type) items = items.filter(item => item.type === type);
      if (status) items = items.filter(item => item.status === status || (['lost', 'found'].includes(status) && item.type === status));
      if (dateRange) {
        const now = new Date();
        const start = new Date(now);
        if (dateRange === 'today') start.setHours(0, 0, 0, 0);
        if (dateRange === 'week') start.setDate(now.getDate() - 7);
        if (dateRange === 'month') start.setMonth(now.getMonth() - 1);
        items = items.filter(item => new Date(item.createdAt || item.date).getTime() >= start.getTime());
      }
      return items;
    }

    function renderItemsPagination(totalItems, totalPages, startIndex) {
      const summary = document.getElementById('paginationSummary');
      const controls = document.getElementById('paginationControls');
      const firstItem = totalItems ? startIndex + 1 : 0;
      const lastItem = totalItems ? Math.min(startIndex + adminItemsPerPage, totalItems) : 0;
      summary.textContent = `Showing ${firstItem} to ${lastItem} of ${totalItems} entries`;

      if (totalPages <= 1) {
        controls.innerHTML = '';
        return;
      }

      const pageButtons = Array.from({ length: totalPages }, (_, index) => {
        const page = index + 1;
        const active = page === adminCurrentPage;
        return `<button type="button" class="pagination-button${active ? ' active' : ''}" onclick="changeAdminItemsPage(${page})" aria-label="Page ${page}"${active ? ' aria-current="page"' : ''}>${page}</button>`;
      }).join('');

      controls.innerHTML = `
        <button type="button" class="pagination-button" onclick="changeAdminItemsPage(${adminCurrentPage - 1})" ${adminCurrentPage === 1 ? 'disabled' : ''}>Previous</button>
        ${pageButtons}
        <button type="button" class="pagination-button" onclick="changeAdminItemsPage(${adminCurrentPage + 1})" ${adminCurrentPage === totalPages ? 'disabled' : ''}>Next</button>`;
    }

    function changeAdminItemsPage(page) {
      const totalPages = Math.max(1, Math.ceil(getFilteredAdminItems().length / adminItemsPerPage));
      adminCurrentPage = Math.max(1, Math.min(Number(page) || 1, totalPages));
      renderItemsTable();
    }

    async function updateItemClaimStatus(id, proof = '') {
      try {
        const response = await adminFetch(`/api/items/${encodeURIComponent(id)}/claim`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proof })
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message || 'Unable to update item status.');
        await refreshAdminItems();
        showToast(data.message);
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    async function updateItemStatus(id, status) {
      try {
        const response = await adminFetch(`/api/items/${encodeURIComponent(id)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message || 'Unable to update item status.');
        await refreshAdminItems();
        showToast(data.message);
      } catch (error) { showToast(error.message, 'error'); }
    }

    function markClaimed(id) {
      updateItemClaimStatus(id, 'Verified by moderator during campus handoff.');
    }

    function markRestore(id, status = 'claimed') {
      if (status === 'archived') updateItemStatus(id, 'active');
      else updateItemClaimStatus(id);
    }

    function openDeleteModal(id, title, reporter = 'Unknown reporter') {
      deleteTargetId = id;
      document.getElementById('deleteMsg').textContent =
        `Delete "${title}" reported by ${reporter}? This action cannot be undone.`;
      document.getElementById('deleteModal').classList.add('open');
    }
    function closeDeleteModal() {
      document.getElementById('deleteModal').classList.remove('open');
      deleteTargetId = null;
    }
    async function doDelete() {
      if (!deleteTargetId) return;

      const id = deleteTargetId;
      const button = document.getElementById('confirmDelete');
      button.disabled = true;
      try {
        const response = await adminFetch(`/api/items/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        const data = await response.json();
        if (!response.ok && response.status !== 404) {
          throw new Error(data.message || 'Unable to delete item. Please try again.');
        }

        closeDeleteModal();
        await refreshAdminItems();
        showToast('Item permanently deleted.');
      } catch (error) {
        showToast(error.message || 'Unable to delete item. Please try again.', 'error');
      } finally {
        button.disabled = false;
      }
    }

    function openClaimReview(id) {
      const claim = claimRequests.find(entry => entry.id === id);
      const item = adminItems.find(entry => String(entry.id) === String(claim?.itemId));
      if (!claim || !item) {
        showToast('Claim or item details are unavailable. Refresh and try again.', 'error');
        return;
      }

      activeClaimReviewId = id;
      const approveButton = document.getElementById('claimApproveButton');
      const rejectButton = document.getElementById('claimRejectButton');
      approveButton.textContent = 'Approve Claim';
      approveButton.onclick = () => prepareClaimDecision('approved');
      approveButton.hidden = false;
      rejectButton.textContent = 'Reject Claim';
      rejectButton.onclick = () => prepareClaimDecision('rejected');
      rejectButton.hidden = false;

      document.getElementById('claimReviewTitle').textContent = `Verify Claim Request - ${item.id}`;
      const proofImage = /^\/uploads\/[a-zA-Z0-9._-]+$/.test(claim.proof || '')
        ? `<img src="${escHtml(claim.proof)}" alt="Claimant proof image" />`
        : '';
      document.getElementById('claimReviewContent').innerHTML = `
        <div class="claim-review-grid">
          <section class="claim-review-section">
            <h3>Claimant Details</h3>
            <p><strong>Student Name:</strong> ${escHtml(claim.claimantName || 'Not provided')}</p>
            <p><strong>Student ID Number:</strong> ${escHtml(claim.claimantStudentId || 'Not provided')}</p>
            <p><strong>Email:</strong> ${escHtml(claim.claimantEmail || 'Not provided')}</p>
            <p><strong>Contact Number:</strong> ${escHtml(claim.claimantContact || 'Not provided')}</p>
            <p><strong>Course &amp; Year:</strong> ${escHtml(claim.claimantCourseYear || 'Not provided')}</p>
            <p><strong>Department:</strong> ${escHtml(claim.claimantDepartment || 'Not provided')}</p>
          </section>
          <section class="claim-review-section">
            <h3>Public Item Details</h3>
            <p><strong>Item:</strong> ${escHtml(item.title)}</p>
            <p><strong>Type / Category:</strong> ${escHtml(item.type)} / ${escHtml(item.category)}</p>
            <p><strong>Location:</strong> ${escHtml(item.location)}</p>
            <p><strong>Description:</strong> ${escHtml(item.desc || item.description || 'No description provided.')}</p>
            ${item.photo ? `<img src="${escHtml(item.photo)}" alt="Reported item" />` : ''}
          </section>
          <section class="claim-review-section">
            <h3>Claimant's Proof / Secret Detail</h3>
            <p>${escHtml(claim.proof || 'No proof detail provided.')}</p>${proofImage}
          </section>
          <section class="claim-review-section">
            <h3>Secret Ownership Detail</h3>
            <p>${escHtml(item.verification || 'No secret ownership detail was provided.')}</p>
          </section>
        </div>`;
      document.getElementById('claimReviewDecisionFields').innerHTML = '';
      document.getElementById('claimReviewModal').classList.add('open');
    }

    function closeClaimReview() {
      document.getElementById('claimReviewModal').classList.remove('open');
      activeClaimReviewId = null;
    }

    function prepareClaimDecision(status) {
      const fields = document.getElementById('claimReviewDecisionFields');
      const approveButton = document.getElementById('claimApproveButton');
      const rejectButton = document.getElementById('claimRejectButton');
      if (status === 'approved') {
        fields.innerHTML = `
          <label for="claimPickupInstructions">Optional pickup instructions</label>
          <textarea class="claim-review-input" id="claimPickupInstructions" rows="2" maxlength="500" placeholder="Please present your CSPC Student ID at the SAS Office, Room 101"></textarea>
          <label for="claimHandoverSignature">Admin handover acknowledgment</label>
          <input class="form-control claim-review-input" id="claimHandoverSignature" maxlength="120" placeholder="Type your full name to acknowledge handover" required />`;
        approveButton.textContent = 'Confirm Approval';
        approveButton.onclick = () => submitClaimDecision('approved');
        rejectButton.hidden = true;
      } else {
        fields.innerHTML = `
          <label for="claimRejectionReason">Reason for rejection</label>
          <textarea class="claim-review-input" id="claimRejectionReason" rows="2" maxlength="500" required placeholder="Proof provided does not match item details"></textarea>`;
        rejectButton.textContent = 'Submit Rejection';
        rejectButton.onclick = () => submitClaimDecision('rejected');
        approveButton.hidden = true;
      }
    }

    async function submitClaimDecision(status) {
      const pickupInstructions = status === 'approved'
        ? document.getElementById('claimPickupInstructions').value.trim()
        : '';
      const handoverSignature = status === 'approved'
        ? document.getElementById('claimHandoverSignature').value.trim()
        : '';
      const rejectionReason = status === 'rejected'
        ? document.getElementById('claimRejectionReason').value.trim()
        : '';
      if (status === 'rejected' && rejectionReason.length < 5) {
        showToast('Enter a rejection reason of at least 5 characters.', 'error');
        return;
      }
      if (status === 'approved' && handoverSignature.length < 2) {
        showToast('Enter your name to acknowledge the physical handover.', 'error');
        return;
      }

      try {
        const response = await adminFetch(`/api/items/claims/${encodeURIComponent(activeClaimReviewId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, pickupInstructions, rejectionReason, handoverSignature })
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message || 'Unable to review claim.');
        closeClaimReview();
        await refreshAdminClaims();
        await refreshAdminItems();
        showToast(data.message);
      } catch (error) {
        showToast(error.message, 'error');
      }
    }

    function toggleSelectAllVisible(event) {
      getFilteredAdminItems().slice((adminCurrentPage - 1) * adminItemsPerPage, adminCurrentPage * adminItemsPerPage).forEach(item => {
        if (event.target.checked) selectedItemIds.add(String(item.id)); else selectedItemIds.delete(String(item.id));
      });
      renderItemsTable();
    }

    function updateBulkToolbar() {
      const count = selectedItemIds.size;
      document.getElementById('selectedItemsCount').textContent = `${count} selected`;
      ['bulkClaimBtn', 'bulkArchiveBtn', 'bulkDeleteBtn', 'exportSelectedBtn'].forEach(id => { document.getElementById(id).disabled = count === 0; });
    }

    function openActionConfirm(title, message) {
      return new Promise(resolve => {
        const modal = document.getElementById('actionConfirmModal');
        const confirmButton = document.getElementById('confirmActionConfirm');
        document.getElementById('actionConfirmTitle').textContent = title;
        document.getElementById('actionConfirmMsg').textContent = message;
        modal.classList.add('open');
        const finish = value => { modal.classList.remove('open'); actionConfirmResolver = null; resolve(value); };
        actionConfirmResolver = () => finish(false);
        confirmButton.onclick = () => finish(true);
        document.getElementById('cancelActionConfirm').onclick = () => finish(false);
      });
    }

    function closeActionConfirm() {
      if (actionConfirmResolver) actionConfirmResolver();
      else document.getElementById('actionConfirmModal').classList.remove('open');
    }

    async function runBulkAction(action) {
      const ids = [...selectedItemIds];
      if (!ids.length) return;
      const actionText = action === 'delete' ? 'delete' : action === 'archive' ? 'archive' : 'mark as claimed';
      if (!await openActionConfirm('Confirm Bulk Action', `Are you sure you want to ${actionText} ${ids.length} selected item(s)?`)) return;
      try {
        const response = await adminFetch('/api/items/bulk', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, action }) });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message || 'Bulk operation failed.');
        ids.forEach(id => selectedItemIds.delete(id));
        await refreshAdminItems();
        await refreshAdminClaims();
        showToast(`${data.affected} item(s) updated.`);
      } catch (error) { showToast(error.message, 'error'); }
    }

    async function sendBroadcast() {
      const subject = document.getElementById('broadcastSubject').value.trim();
      const message = document.getElementById('broadcastMessage').value.trim();
      if (subject.length < 3 || message.length < 5) return showToast('Enter a subject and message first.', 'error');
      if (!await openActionConfirm('Confirm Broadcast', 'Send this announcement to all registered students?')) return;
      const button = document.getElementById('sendBroadcastBtn');
      button.disabled = true;
      try {
        const response = await adminFetch('/api/items/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject, message }) });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message || 'Broadcast failed.');
        document.getElementById('broadcastSubject').value = '';
        document.getElementById('broadcastMessage').value = '';
        showToast(`Broadcast sent to ${data.sent} of ${data.recipients} student(s).`);
      } catch (error) { showToast(error.message, 'error'); } finally { button.disabled = false; }
    }

    async function openActivityModal(id) {
      const item = adminItems.find(entry => String(entry.id) === String(id));
      if (!item) return;
      document.getElementById('activityTitle').textContent = `Activity: ${item.title}`;
      document.getElementById('activityNote').dataset.itemId = id;
      document.getElementById('activityNote').value = '';
      document.getElementById('activityContent').innerHTML = '<p>Loading activity…</p>';
      document.getElementById('activityModal').classList.add('open');
      try {
        const response = await adminFetch(`/api/items/${encodeURIComponent(id)}/activity`);
        const data = await response.json();
        document.getElementById('activityContent').innerHTML = data.activity?.length
          ? `<div class="activity-list">${data.activity.map(entry => `<div class="activity-entry"><strong>${escHtml(entry.action)}</strong><span>${escHtml(entry.actorName)} · ${formatDate(entry.timestamp)}</span>${entry.notes ? `<p>${escHtml(entry.notes)}</p>` : ''}</div>`).join('')}</div>`
          : '<p class="activity-empty">No activity recorded yet.</p>';
      } catch (error) { document.getElementById('activityContent').innerHTML = `<p class="activity-empty">${escHtml(error.message)}</p>`; }
    }

    function closeActivityModal() { document.getElementById('activityModal').classList.remove('open'); }

    async function saveActivityNote() {
      const note = document.getElementById('activityNote');
      if (!note.value.trim()) return showToast('Enter a note first.', 'error');
      const response = await adminFetch(`/api/items/${encodeURIComponent(note.dataset.itemId)}/activity`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: note.value.trim() }) });
      const data = await response.json();
      if (!response.ok || !data.success) return showToast(data.message || 'Unable to save note.', 'error');
      note.value = '';
      openActivityModal(note.dataset.itemId);
      showToast('Activity note saved.');
    }

    function exportCSV(selectedIds = null) {
      const items = selectedIds ? adminItems.filter(item => selectedIds.includes(String(item.id))) : adminItems;
      const headers = ['ID','Type','Title','Category','Location','Status','Reporter','Contact','Email','Date Lost/Found','Created At'];
      const rows = items.map(i => [
        i.id, i.type, i.title, i.category, i.location, i.status,
        i.reporterName, i.reporterContact, i.reporterEmail || '',
        i.dateLost || i.dateFound || '', i.createdAt
      ].map(v => `"${String(v || '').replace(/"/g,'""')}"`).join(','));

      const csv = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `cspc-lostfound-${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('CSV exported successfully.');
    }

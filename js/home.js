let currentUser = null;
    let currentFilter = 'all';
    let currentLocationFilter = '';
    let currentPage = 1;
    const itemsPerPage = 6;
    let loadedItems = [];

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
      if (slot) slot.innerHTML = '<a href="/login" class="btn btn-primary nav-signin-btn">Sign In</a>';
      if (chipVault) chipVault.style.display = 'none';
    }

    async function checkAuthSession() {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
        if (!res.ok) throw new Error('Unable to verify the current session.');
        const data = await res.json();

        if (data.authenticated && data.user && ['admin', 'student'].includes(data.user.role)) {
          currentUser = data.user;
          sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
          sessionStorage.setItem('userRole', currentUser.role);
          const isAdmin = currentUser.role === 'admin';
          const roleLabel = isAdmin ? '' : 'Student';
          document.getElementById('userNavSlot').innerHTML = `
            <button type="button" id="notifBellBtn" onclick="openNotificationsModal()" class="notif-bell-btn" title="View QR Recovery Alerts">
              🔔 <span id="notifCountBadge" class="notif-badge" style="display:none;">0</span>
            </button>
            <div class="user-pill">
              <span class="user-name">${escapeHtml(isAdmin ? 'Admin' : currentUser.fullName)}</span>
              ${roleLabel ? `<span class="role-badge">${roleLabel}</span>` : ''}
              <button type="button" onclick="handleLogout()" class="user-pill-logout" title="Sign out of account">Logout</button>
            </div>
          `;
          const chipVault = document.getElementById('chipMyBelongings');
          if (chipVault) chipVault.style.display = 'inline-block';
          fetchMyBelongingsCount();
          loadMyNotifications();
          fetchAndRenderItems();

          // Pre-fill contact if student has details
          if (!document.getElementById('itemContact').value) {
            document.getElementById('itemContact').value = `${currentUser.fullName} (${currentUser.email})`;
          }
        } else {
          clearStoredAuth();
          renderGuestHeader();
          fetchAndRenderItems();
        }
      } catch (err) {
        clearStoredAuth();
        renderGuestHeader();
        fetchAndRenderItems();
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

    async function fetchAndRenderItems() {
      currentPage = 1;
      const search = document.getElementById('searchInput').value.trim();
      const matchItemId = new URLSearchParams(window.location.search).get('matchItemId');
      const params = new URLSearchParams();

      if (currentFilter === 'lost') params.append('type', 'lost');
      if (currentFilter === 'found') params.append('type', 'found');
      if (currentFilter === 'claimed') params.append('status', 'claimed');
      if (currentFilter === 'registered') params.append('type', 'registered');
      if (currentLocationFilter) params.append('location', currentLocationFilter);
      if (search) params.append('search', search);

      try {
        const res = await fetch(`/api/items?${params.toString()}`);
        const data = await res.json();
        if (data.success) {
          loadedItems = data.items;
          renderItemsGrid(loadedItems);
          if (matchItemId) {
            const matchCard = document.getElementById(`item-card-${matchItemId}`);
            if (matchCard) matchCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          fetchStats();
        }
      } catch (err) {
        document.getElementById('itemsGrid').innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: #f87171;">
            Failed to connect to campus records server.
          </div>
        `;
      }
    }

    function renderItemsGrid(items) {
      const grid = document.getElementById('itemsGrid');
      const pagination = document.getElementById('itemsPagination');

      if (!items || items.length === 0) {
        pagination.innerHTML = '';
        if (currentFilter === 'registered') {
          grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3.5rem 1rem; background: rgba(59,130,246,0.06); border: 1.5px dashed rgba(59,130,246,0.35); border-radius: 16px;">
              <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🏷️</div>
              <h3 style="font-size: 1.15rem; font-weight: 800; color: #93c5fd; margin-bottom: 0.4rem;">Your Belongings Vault is Empty</h3>
              <p style="font-size: 0.84rem; color: var(--text-muted); max-width: 480px; margin: 0 auto 1.25rem; line-height: 1.5;">
                Register your personal laptops, tumblers, water bottles, and binder folders before they get lost to generate your unique, anonymous QR recovery sticker!
              </p>
              <button class="btn btn-primary" onclick="handleOpenRegisterBelonging()">+ Register a Belonging Now</button>
            </div>
          `;
          return;
        }

        grid.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
            <p style="font-size: 1.1rem; font-weight: 600;">No items found</p>
          </div>
        `;
        return;
      }

      const totalPages = Math.ceil(items.length / itemsPerPage);
      if (currentPage > totalPages) currentPage = totalPages;
      const pageItems = items.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

      grid.innerHTML = pageItems.map(item => {
        // Special render for personal preventive registered belongings
        if (item.type === 'registered') {
          const canManageRegistered = currentUser?.role === 'admin' || item.reportedBy === currentUser?.id;
          return `
            <div class="project-card" id="item-card-${item.id}" style="border-color: rgba(59,130,246,0.45); background: rgba(59,130,246,0.04);">
              <div class="project-card-header">
                <div style="flex: 1;">
                  <div class="item-card-meta-row">
                    <div class="item-card-category-ref">
                      <span class="project-type" style="color: #93c5fd;">${escapeHtml(item.category)}</span>
                      <span class="ref-code" style="margin-left: 0.4rem; color: #60a5fa;">${escapeHtml(item.refCode || '')}</span>
                    </div>
                    <span class="item-badge badge-registered">🔒 Registered Belonging</span>
                  </div>
                  <h3 style="margin-top: 0.35rem; color: #ffffff;">${escapeHtml(item.title)}</h3>
                </div>
              </div>

              <div style="background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.22); border-radius: 8px; padding: 0.6rem 0.75rem; margin: 0.5rem 0; font-size: 0.74rem; color: #bfdbfe; line-height: 1.4;">
                🛡️ <strong>Preventive Protection Active:</strong> Paste QR sticker onto this item. If someone scans it, an anonymous notification goes straight to your account.
              </div>

              <p class="item-card-description" style="margin-top: 0.25rem;">${escapeHtml(item.desc)}</p>

              <div class="card-meta-line">
                <span><strong>Primary Building:</strong> ${escapeHtml(item.location)}</span>
                <span><strong>Registered:</strong> ${formatTimestamp(item.createdAt || item.date)}</span>
                ${item.instructions ? `<span><strong>Finder Instructions:</strong> ${escapeHtml(item.instructions)}</span>` : ''}
              </div>

              <div class="card-actions" style="margin-top: 1rem;">
                ${canManageRegistered ? `<button class="btn-sm btn-qr" onclick="openQrStickerModal(${item.id})">🏷️ QR Sticker</button>` : ''}
                ${canManageRegistered ? `<button class="btn-sm btn-outline" style="border-color: rgba(34,197,94,0.4); color: #86efac;" onclick="openAnonymousFinderModal('${escapeHtml(item.refCode)}')">📱 Test Finder Screen</button>` : ''}
                ${currentUser?.role === 'admin' ? `<button class="btn-sm btn-del" onclick="deleteItem(${item.id})">Unregister</button>` : ''}
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

        const canManageStatus = currentUser?.role === 'admin';
        const canGetQrSticker = currentUser?.role === 'admin';
        const canRequestClaim = item.type === 'found' && !item.claimed && (!currentUser || item.reportedBy !== currentUser.id);
        const claimBtnText = item.claimed ? 'Mark Unclaimed' : 'Mark Claimed';

        let matchBannerHtml = '';
        if (item.potentialMatch) {
          matchBannerHtml = `
            <div class="match-banner">
              <div>
                <strong>Potential Match:</strong> ${escapeHtml(item.potentialMatch.title)} (${escapeHtml(item.potentialMatch.location)})
              </div>
              <button class="btn-match-qr" onclick="openMatchQrModal(${item.id}, ${item.potentialMatch.id})">🤝 Match Reference QR</button>
            </div>
          `;
        }

        const canDelete = currentUser?.role === 'admin';
        const delBtnHtml = canDelete
          ? `<button class="btn-sm btn-del" onclick="deleteItem(${item.id})">Remove</button>`
          : '';
        const claimBtnHtml = canManageStatus
          ? `<button class="btn-sm btn-claim" onclick="toggleClaim(${item.id})">${claimBtnText}</button>`
          : canRequestClaim
            ? `<button class="btn-sm btn-claim" onclick="openClaimRequestModal(${item.id})">Request Claim</button>`
            : '';

        const photoHtml = item.photo ? `
          <div style="width: 100%; height: 180px; overflow: hidden; border-radius: 8px; margin: 0.6rem 0; background: rgba(0,0,0,0.3); border: 1px solid rgba(59,130,246,0.3); display: flex; align-items: center; justify-content: center; cursor: pointer; position: relative;" onclick="openImageModal('${escapeHtml(item.photo)}', '${escapeHtml(item.title)}')">
            <img src="${item.photo}" alt="${escapeHtml(item.title)}" style="width: 100%; height: 100%; object-fit: cover;" />
            <span style="position: absolute; bottom: 6px; right: 6px; background: rgba(0,0,0,0.75); color: var(--blue-light); font-size: 0.68rem; font-weight: 700; padding: 0.2rem 0.5rem; border-radius: 4px; backdrop-filter: blur(4px);">🔍 View Photo</span>
          </div>
        ` : '';

        return `
          <div class="project-card" id="item-card-${item.id}">
            <div class="project-card-header">
              <div style="flex: 1;">
                <div class="item-card-meta-row">
                  <div class="item-card-category-ref">
                    <span class="project-type">${escapeHtml(item.category)}</span>
                    <span class="ref-code" style="margin-left: 0.4rem;">${escapeHtml(item.refCode || '')}</span>
                  </div>
                  ${badgeHtml}
                </div>
                <h3 style="margin-top: 0.35rem;">${escapeHtml(item.title)}</h3>
              </div>
            </div>

            ${matchBannerHtml}

            ${photoHtml}

            <p class="item-card-description" style="margin-top: 0.25rem;">${escapeHtml(item.desc)}</p>

            <div class="card-meta-line">
              <span><strong>Location:</strong> ${escapeHtml(item.location)}</span>
              <span><strong>Reported:</strong> ${formatTimestamp(item.createdAt || item.date)}</span>
              ${item.claimedAt ? `<span><strong>Claimed:</strong> ${formatTimestamp(item.claimedAt)}</span>` : ''}
            </div>

            <div class="card-actions">

              ${delBtnHtml}
            </div>
          </div>
        `;
      }).join('');
      renderItemsPagination(totalPages);
    }

    function renderItemsPagination(totalPages) {
      const pagination = document.getElementById('itemsPagination');
      if (!pagination || totalPages <= 1) {
        if (pagination) pagination.innerHTML = '';
        return;
      }

      let controls = `<button class="pagination-btn" onclick="goToItemsPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>Previous</button>`;
      for (let page = 1; page <= totalPages; page++) {
        controls += `<button class="pagination-btn ${page === currentPage ? 'active' : ''}" onclick="goToItemsPage(${page})" aria-label="Page ${page}">${page}</button>`;
      }
      controls += `<button class="pagination-btn" onclick="goToItemsPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>Next</button>`;
      pagination.innerHTML = controls;
    }

    function goToItemsPage(page) {
      currentPage = page;
      renderItemsGrid(loadedItems);
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

    function setFilter(filter, el) {
      currentFilter = filter;
      currentPage = 1;
      document.querySelectorAll('.filter-chips .chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.filter === filter);
      });
      document.querySelectorAll('.hero-stats .stat-box').forEach(stat => {
        const active = stat.dataset.filter === filter;
        stat.classList.toggle('active', active);
        stat.setAttribute('aria-pressed', String(active));
      });
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

      // Encodes anonymous notification endpoint for finder
      const qrData = encodeURIComponent(`https://lostfound.cspc.edu.ph/found?ref=${refCode}&item=${encodeURIComponent(item.title)}`);
      document.getElementById('qrCodeImage').src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${qrData}`;

      toggleAnonymousDemo(false);
      document.getElementById('qrModal').classList.add('open');
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

    function closeRegisterBelongingModal() {
      document.getElementById('registerBelongingModal').classList.remove('open');
      const form = document.getElementById('registerBelongingForm');
      if (form) form.reset();
      resetCategoryPicker('regCategory');
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
      picker.innerHTML = `<span class="category-picker-selected-icon">${icon}</span>${value}`;
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
        const res = await fetch('/api/items/register-belonging', {
          method: 'POST',
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

        // Open QR sticker modal for the newly registered item
        openQrStickerModal(data.item.id);

        // Refresh belonging count chip
        fetchMyBelongingsCount();

        // Refresh feed if currently showing registered items
        if (currentFilter === 'registered') fetchAndRenderItems();

      } catch (err) {
        showToast('Server error. Please try again.', 'error');
      }
    }

    // ── Anonymous Finder Modal ────────────────────────────────────────────────
    async function openAnonymousFinderModal(refCode) {
      try {
        const res = await fetch(`/api/items/qr-lookup/${encodeURIComponent(refCode)}`);
        const data = await res.json();
        if (!data.success) {
          showToast('Could not load item info. Invalid QR code.', 'error');
          return;
        }
        const item = data.item;
        document.getElementById('finderScreenItemTitle').textContent = item.title;
        document.getElementById('finderScreenRefCode').textContent = item.refCode;
        document.getElementById('finderScreenInstructions').textContent = item.instructions || 'If found, please send a message or return to CSPC SASO / Campus Security Desk.';
        document.getElementById('finderRefCodeInput').value = item.refCode;
        document.getElementById('finderMessageInput').value = '';
        document.getElementById('finderLocationInput').value = '';
        document.getElementById('finderContactInput').value = '';
        document.getElementById('anonymousFinderModal').classList.add('open');
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
      const message       = document.getElementById('finderMessageInput').value.trim();
      const locationFound = document.getElementById('finderLocationInput').value.trim();
      const finderContact = document.getElementById('finderContactInput').value.trim();

      if (!message) {
        showToast('Please describe where and how you found the item.', 'error');
        return;
      }

      try {
        const res = await fetch('/api/items/anonymous-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refCode, message, locationFound, finderContact })
        });
        const data = await res.json();
        if (data.success) {
          showToast('📲 Anonymous alert delivered to the owner\'s account!');
          closeAnonymousFinderModal();
        } else {
          showToast(data.message || 'Failed to send notification.', 'error');
        }
      } catch (err) {
        showToast('Server error. Please try again.', 'error');
      }
    }

    // ── Match QR Modal ────────────────────────────────────────────────────────
    async function openMatchQrModal(lostId, foundId) {
      try {
        const [r1, r2] = await Promise.all([
          fetch(`/api/items/${lostId}`).then(r => r.json()),
          fetch(`/api/items/${foundId}`).then(r => r.json())
        ]);
        const first = r1.item || {};
        const second = r2.item || {};
        const lost = first.type === 'lost' ? first : second;
        const found = first.type === 'found' ? first : second;

        document.getElementById('matchLostTitle').textContent  = lost.title  || '—';
        document.getElementById('matchFoundTitle').textContent = found.title || '—';
        document.getElementById('matchLostRef').textContent    = lost.refCode  || '—';
        document.getElementById('matchFoundRef').textContent   = found.refCode || '—';

        const matchPayload = encodeURIComponent(
          `CSPC Match Reference | Lost: ${lost.refCode} | Found: ${found.refCode} | Reference only—not handover authorization`
        );
        document.getElementById('matchQrImage').src =
          `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${matchPayload}`;

        document.getElementById('matchQrModal').classList.add('open');
      } catch (err) {
        showToast('Could not generate match QR. Please try again.', 'error');
      }
    }

    function closeMatchQrModal() {
      document.getElementById('matchQrModal').classList.remove('open');
    }

    function printMatchQr() {
      window.print();
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
      list.innerHTML = '<p style="text-align:center;color:#888;padding:24px;">Loading…</p>';
      try {
        const res = await fetch('/api/items/my-notifications');
        const data = await res.json();
        if (!data.success) {
          list.innerHTML = '<p style="text-align:center;color:#888;padding:24px;">Could not load notifications.</p>';
          return;
        }
        if (!data.notifications.length) {
          list.innerHTML = '<p style="text-align:center;color:#888;padding:24px;">No account notifications yet.</p>';
          return;
        }

        list.innerHTML = data.notifications.map(n => `
          <div class="notif-item${n.read ? '' : ' unread'}" data-id="${n.id}">
            <div class="notif-header">
              <strong>🏷️ ${n.itemTitle || n.refCode}</strong>
              <span class="notif-time">${new Date(n.timestamp).toLocaleString()}</span>
            </div>
            ${n.notificationType === 'match'
              ? `<p class="notif-msg"><strong>Possible match—not confirmed</strong></p>
                 <p class="notif-msg">${escapeHtml(n.message)}</p>
                 <a class="btn-mark-read" style="display:inline-block;text-decoration:none;" href="/?search=${encodeURIComponent(n.matchRefCode || '')}&amp;matchItemId=${encodeURIComponent(n.matchItemId || '')}#items">Review possible match</a>`
              : n.notificationType === 'claim'
                ? `<p class="notif-msg">Claim request update</p><p class="notif-msg">${n.message}</p>`
                : `<p class="notif-msg">📍 <em>${n.locationFound || 'Location not specified'}</em></p>
                 <p class="notif-msg">💬 ${n.message}</p>
                 ${n.finderContact && n.finderContact !== 'Anonymous Student / Finder'
                   ? `<p class="notif-contact">📞 Finder left optional contact: ${n.finderContact}</p>`
                   : '<p class="notif-contact">🔒 Finder remained anonymous</p>'}`}
            ${!n.read ? `<button class="btn-mark-read" onclick="markNotifRead('${n.id}', this)">Mark as read</button>` : ''}
          </div>
        `).join('');

        // Update badge
        const badge = document.getElementById('notifCountBadge');
        if (badge) {
          const unread = data.unreadCount || 0;
          badge.textContent = unread;
          badge.style.display = unread > 0 ? 'inline-flex' : 'none';
        }
      } catch (err) {
        list.innerHTML = '<p style="text-align:center;color:#888;padding:24px;">Failed to load notifications.</p>';
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

    function openImageModal(photoSrc, title) {
      if (!photoSrc) return;
      document.getElementById('imageModalImg').src = photoSrc;
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
      removePhoto();
      resetCategoryPicker('itemCategory');
      updateTypeRadio();
    }

    async function handleFormSubmit(e) {
      e.preventDefault();
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
          body: payload
        });

        const data = await res.json();
        if (data.success) {
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
      }
    }

    let targetDeleteId = null;
    let targetClaimId = null;
    let claimRequestMode = false;
    let claimSubmissionInProgress = false;
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
      claimRequestMode = false;
      targetClaimId = id;

      const titleEl = document.getElementById('claimModalTitle');
      const subtitleEl = document.getElementById('claimModalSubtitle');
      const hintBox = document.getElementById('claimVerificationBox');
      const hintText = document.getElementById('claimModalHint');
      const proofGroup = document.getElementById('claimProofGroup');
      const proofInput = document.getElementById('claimProofInput');
      const btnEl = document.getElementById('claimModalBtn');
      const proofLabel = document.querySelector('label[for="claimProofInput"]');

      clearClaimFeedback();
      document.getElementById('claimantDetailsGroup').style.display = 'none';
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

    function openClaimRequestModal(id) {
      const item = loadedItems.find(i => String(i.id) === String(id));
      if (!item || item.type !== 'found' || item.claimed) return;
      if (!currentUser) {
        window.location.href = '/login';
        return;
      }

      claimRequestMode = true;
      targetClaimId = id;
      document.getElementById('claimModalTitle').innerText = 'Request this item';
      document.getElementById('claimModalSubtitle').innerText = 'Describe identifying details only the rightful owner would know. Only moderators can view your response.';
      document.getElementById('claimVerificationBox').style.display = 'none';
      document.getElementById('claimProofGroup').style.display = 'block';
      document.getElementById('claimantDetailsGroup').style.display = 'block';
      document.querySelector('label[for="claimProofInput"]').textContent = 'Private ownership details';
      const proofInput = document.getElementById('claimProofInput');
      clearClaimFeedback();
      proofInput.value = '';
      proofInput.placeholder = 'Describe a mark, contents, or other private identifying detail';
      proofInput.oninput = clearClaimFeedback;
      document.getElementById('claimantCourseYearInput').value = currentUser.courseYear || currentUser.yearLevel || '';
      document.getElementById('claimantContactInput').value = currentUser.phone || currentUser.contactNumber || '';
      document.getElementById('claimModalBtn').innerText = 'Submit Request';
      document.getElementById('claimConfirmModal').classList.add('open');
    }

    function closeClaimModal(force = false) {
      if (claimSubmissionInProgress && !force) return;
      document.getElementById('claimConfirmModal').classList.remove('open');
      document.getElementById('claimantDetailsGroup').style.display = 'none';
      clearClaimFeedback();
      targetClaimId = null;
      claimRequestMode = false;
    }

    function clearClaimFeedback() {
      ['claimProofError', 'claimCourseYearError', 'claimModalError'].forEach(id => {
        const error = document.getElementById(id);
        if (error) {
          error.textContent = '';
          error.style.display = 'none';
        }
      });
      ['claimProofInput', 'claimantCourseYearInput'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
          input.setAttribute('aria-invalid', 'false');
          input.style.borderColor = 'rgba(59,130,246,0.25)';
        }
      });
    }

    function showClaimFieldError(inputId, errorId, message) {
      const input = document.getElementById(inputId);
      const error = document.getElementById(errorId);
      input.setAttribute('aria-invalid', 'true');
      input.style.borderColor = '#f87171';
      error.textContent = message;
      error.style.display = 'block';
      input.focus();
    }

    function showClaimModalError(message) {
      const error = document.getElementById('claimModalError');
      error.textContent = message;
      error.style.display = 'block';
    }

    async function executeClaimToggle() {
      if (!targetClaimId || claimSubmissionInProgress) return;
      const id = targetClaimId;
      const proof = document.getElementById('claimProofInput').value.trim();
      const isRequest = claimRequestMode;
      const courseYear = isRequest ? document.getElementById('claimantCourseYearInput').value.trim() : '';
      const contactNumber = isRequest ? document.getElementById('claimantContactInput').value.trim() : '';
      clearClaimFeedback();
      if (isRequest && proof.length < 5) {
        showClaimFieldError('claimProofInput', 'claimProofError', 'Enter private ownership details (at least 5 characters).');
        return;
      }
      if (isRequest && proof.length > 500) {
        showClaimFieldError('claimProofInput', 'claimProofError', 'Ownership details must be 500 characters or fewer.');
        return;
      }
      if (isRequest && !courseYear) {
        showClaimFieldError('claimantCourseYearInput', 'claimCourseYearError', 'Enter your course and year level.');
        return;
      }

      const submitButton = document.getElementById('claimModalBtn');
      const originalButtonText = submitButton.textContent;
      claimSubmissionInProgress = true;
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.textContent = isRequest ? 'Submitting...' : 'Saving...';
      try {
        const response = await fetch(isRequest ? `/api/items/${id}/claim-requests` : `/api/items/${id}/claim`, {
          method: isRequest ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proof, courseYear, contactNumber })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.message || 'Unable to update item status.');
        closeClaimModal(true);
        if (!isRequest) {
          fetchStats();
          fetchAndRenderItems();
        }
        showToast(data.message || (isRequest ? 'Claim request submitted for review.' : 'Item status updated.'));
      } catch (error) {
        showClaimModalError(error.message || (isRequest ? 'Failed to submit the claim request.' : 'Failed to update status.'));
      } finally {
        claimSubmissionInProgress = false;
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
        submitButton.textContent = originalButtonText;
      }
    }

    function toggleClaim(id) {
      openClaimModal(id);
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
      if (isError) toast.style.borderColor = '#ef4444';
      toast.innerText = msg;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3200);
    }

    // Mobile nav toggle


    // Theme toggle






    // Initial load
    document.addEventListener('DOMContentLoaded', () => {
      const matchParams = new URLSearchParams(window.location.search);
      if (matchParams.get('matchItemId') && matchParams.get('search')) {
        document.getElementById('searchInput').value = matchParams.get('search');
      }
      checkAuthSession();
      fetchStats();
      window.setInterval(loadMyNotifications, 30000);
      fetchAndRenderItems();

      const reportType = new URLSearchParams(window.location.search).get('report');
      if (reportType === 'lost' || reportType === 'found') {
        const typeInput = document.querySelector(`input[name="itemType"][value="${reportType}"]`);
        if (typeInput) typeInput.checked = true;
        updateTypeRadio();
        document.getElementById('itemForm').scrollIntoView({ behavior: 'smooth' });
      }

    });

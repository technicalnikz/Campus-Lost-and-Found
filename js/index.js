const STORAGE_KEY = 'cspc_simple_lostfound_v2';

  let currentUser = null;
    let currentFilter = 'all';
    let currentLocationFilter = '';
    let currentPage = 1;
    const itemsPerPage = 6;

    function clearStoredAuth() {
      ['adminToken', 'currentUser', 'userRole'].forEach(key => {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      });
    }

    function renderGuestHeader() {
      currentUser = null;
      const slot = document.getElementById('userNavSlot');
      if (slot) slot.innerHTML = '<a href="/login" class="btn btn-primary nav-signin-btn">Sign In</a>';
    }

    async function checkAuthSession() {
      let tabUser;
      try {
        tabUser = JSON.parse(sessionStorage.getItem('currentUser') || 'null');
      } catch (error) {
        tabUser = null;
      }
      if (!tabUser || !['admin', 'student'].includes(tabUser.role) || sessionStorage.getItem('userRole') !== tabUser.role) {
        clearStoredAuth();
        renderGuestHeader();
        return;
      }

      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
        const data = await response.json();
        if (!response.ok || !data.authenticated || !data.user || data.user.id !== tabUser.id || data.user.role !== tabUser.role) {
          clearStoredAuth();
          renderGuestHeader();
          return;
        }
        currentUser = data.user;
        if (currentUser.role === 'admin' && window.location.pathname === '/') {
          window.location.replace('/admin.html');
          return;
        }
        document.getElementById('userNavSlot').innerHTML = `
          <div class="user-pill">
            <span class="user-name">${currentUser.role === 'admin' ? 'Admin' : escapeHtml(currentUser.fullName)}</span>
            ${currentUser.role === 'admin' ? '' : '<span class="role-badge">Student</span>'}
            <button type="button" onclick="handleLogout()" class="user-pill-logout">Logout</button>
          </div>`;
        renderItems();
      } catch (error) {
        clearStoredAuth();
        renderGuestHeader();
      }
    }

    async function handleLogout() {
      try {
        const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
        if (!response.ok) throw new Error('Logout request failed.');
        clearStoredAuth();
        renderGuestHeader();
        renderItems();
        showToast('Signed out successfully.');
      } catch (error) {
        showToast('Unable to sign out.');
      }
    }

    function getItems() {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
        return [];
      }
      const savedItems = JSON.parse(saved);
      const items = savedItems.filter(item => {
        const sampleRefCode = `CSPC-LF-2026-${String(item.id).padStart(3, '0')}`;
        return !(Number.isInteger(item.id) && item.id >= 1 && item.id <= 5 && item.refCode === sampleRefCode);
      });
      if (items.length !== savedItems.length) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      }
      // Ensure all items have refCodes
      items.forEach((item, idx) => {
        if (!item.refCode) {
          item.refCode = "CSPC-LF-2026-" + String(idx + 1).padStart(3, '0');
        }
      });
      return items;
    }

    function saveItems(items) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
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
      renderItems();
    }

    function setLocationFilter(loc) {
      currentLocationFilter = (loc || '').toLowerCase();
      currentPage = 1;
      renderItems();
    }

    // UNIQUE FEATURE: Smart Match & Reconciliation Detector
    function normalizeText(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function tokenizeText(value) {
      const stopWords = new Set([
        'with', 'case', 'blue', 'black', 'item', 'lost', 'found', 'cspc', 'college',
        'the', 'and', 'for', 'from', 'near', 'this', 'that', 'into', 'onto', 'there',
        'please', 'return', 'owner', 'campus', 'building', 'student', 'report', 'reports'
      ]);

      return normalizeText(value)
        .split(' ')
        .filter(word => word.length > 2 && !stopWords.has(word));
    }

    function computeTokenSimilarity(a, b) {
      const tokensA = tokenizeText(a);
      const tokensB = tokenizeText(b);

      if (!tokensA.length || !tokensB.length) return 0;

      const setA = new Set(tokensA);
      const setB = new Set(tokensB);
      const intersection = [...setA].filter(token => setB.has(token)).length;
      const union = new Set([...tokensA, ...tokensB]).size;

      if (union === 0) return 0;

      const jaccard = intersection / union;
      const overlap = intersection / Math.min(tokensA.length, tokensB.length);
      return Math.max(jaccard, overlap);
    }

    function compareVerificationHints(left, right) {
      const a = normalizeText(left || '');
      const b = normalizeText(right || '');
      if (!a || !b) return 0;

      const tokensA = new Set(tokenizeText(a));
      const tokensB = new Set(tokenizeText(b));
      const overlap = [...tokensA].filter(token => tokensB.has(token)).length;

      return overlap > 0 ? 1 : 0;
    }

    function scorePotentialMatch(item, other) {
      const categoryMatch = item.category && other.category && item.category === other.category;
      const locationA = normalizeText(item.location);
      const locationB = normalizeText(other.location);
      const sameLocation = !!(locationA && locationB && (
        locationA.includes(locationB.split(' ')[0]) ||
        locationB.includes(locationA.split(' ')[0]) ||
        locationA === locationB
      ));

      const nameSimilarity = computeTokenSimilarity(item.title, other.title);
      const descSimilarity = computeTokenSimilarity(item.desc || '', other.desc || '');
      const verificationScore = compareVerificationHints(item.verification, other.verification);

      const categoryWeight = categoryMatch ? 0.46 : 0;
      const nameWeight = Math.max(nameSimilarity, descSimilarity) * 0.33;
      const verificationWeight = verificationScore * 0.18;
      const locationWeight = sameLocation ? 0.08 : 0;
      const score = categoryWeight + nameWeight + verificationWeight + locationWeight;

      return { score, categoryMatch, sameLocation, nameSimilarity, descSimilarity, verificationScore };
    }

    function findMatch(item, allItems) {
      if (item.claimed) return null;
      const targetType = item.type === 'lost' ? 'found' : 'lost';

      let bestMatch = null;
      let bestScore = 0;
      let bestMeta = null;

      for (const other of allItems) {
        if (other.id === item.id || other.type !== targetType || other.claimed) continue;

        const meta = scorePotentialMatch(item, other);
        if (meta.score > bestScore) {
          bestScore = meta.score;
          bestMatch = other;
          bestMeta = meta;
        }
      }

      const hasStrongCategory = !!(bestMeta && bestMeta.categoryMatch);
      const hasStrongNameSimilarity = !!(bestMeta && bestMeta.nameSimilarity >= 0.28);
      const hasStrongDescriptionSimilarity = !!(bestMeta && bestMeta.descSimilarity >= 0.22);
      const hasVerificationOverlap = !!(bestMeta && bestMeta.verificationScore > 0);

      if (!bestMatch || !bestMeta) return null;
      if (!hasStrongCategory) return null;
      if (!hasStrongNameSimilarity && !hasStrongDescriptionSimilarity && !hasVerificationOverlap) return null;
      if (bestScore < 0.58) return null;

      return bestMatch;
    }

    function renderItems() {
      const items = getItems();
      const search = document.getElementById('searchInput').value.toLowerCase().trim();
      const grid = document.getElementById('itemsGrid');
      const pagination = document.getElementById('itemsPagination');

      // Update counters
      const total = items.filter(i => i.type !== 'registered').length;
      const lostCount = items.filter(i => i.type === 'lost').length;
      const foundCount = items.filter(i => i.type === 'found').length;
      const claimedCount = items.filter(i => i.claimed || i.status === 'claimed').length;
      const regCount = items.filter(i => i.type === 'registered').length;

      document.getElementById('statTotal').innerText = total;
      document.getElementById('statLost').innerText = lostCount;
      document.getElementById('statFound').innerText = foundCount;
      document.getElementById('statClaimed').innerText = claimedCount;

      const regBadge = document.getElementById('myBelongingsCount');
      if (regBadge) regBadge.innerText = regCount;

      // Filter by type
      let filtered = items.filter(item => {
        if (currentFilter === 'registered') return item.type === 'registered';
        if (item.type === 'registered') return false; // Hide registered belongings from public tabs
        if (currentFilter === 'lost') return item.type === 'lost' && !item.claimed;
        if (currentFilter === 'found') return item.type === 'found' && !item.claimed;
        if (currentFilter === 'claimed') return item.claimed;
        return true;
      });

      // Filter by location hotspot
      if (currentLocationFilter) {
        filtered = filtered.filter(item => item.location.toLowerCase().includes(currentLocationFilter));
      }

      // Filter by search text
      if (search) {
        filtered = filtered.filter(item =>
          item.title.toLowerCase().includes(search) ||
          item.location.toLowerCase().includes(search) ||
          item.desc.toLowerCase().includes(search) ||
          item.category.toLowerCase().includes(search) ||
          (item.refCode && item.refCode.toLowerCase().includes(search))
        );
      }

      if (filtered.length === 0) {
        pagination.innerHTML = '';
        grid.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
            <p style="font-size: 1.1rem; font-weight: 600;">No items found</p>
            <p style="font-size: 0.85rem; margin-top: 0.35rem;">Try clearing your search or location filter.</p>
          </div>
        `;
        return;
      }

      const totalPages = Math.ceil(filtered.length / itemsPerPage);
      if (currentPage > totalPages) currentPage = totalPages;
      const pageItems = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

      grid.innerHTML = pageItems.map(item => {
        // Special rendering for registered belongings in vault
        if (item.type === 'registered') {
          return `
            <div class="project-card" id="item-card-${item.id}" style="border-color: rgba(59, 130, 246, 0.4); background: rgba(30, 41, 59, 0.35);">
              <div class="project-card-header">
                <div class="item-card-header-content">
                  <div class="item-card-meta-row">
                    <div class="item-card-category-ref">
                      <span class="project-type" title="${escapeHtml(item.category)}" style="color: #93c5fd;">${escapeHtml(item.category)}</span>
                      <span class="ref-code" title="${escapeHtml(item.refCode || '')}" style="color: #60a5fa;">${escapeHtml(item.refCode || '')}</span>
                    </div>
                    <span class="item-badge badge-registered">🔒 Registered Belonging</span>
                  </div>
                  <h3 style="margin-top: 0.35rem; color: #ffffff;">${escapeHtml(item.title)}</h3>
                </div>
              </div>

              <p class="item-card-description" style="margin-top: 0.25rem; color: #cbd5e1;">${escapeHtml(item.desc)}</p>

              <div class="card-meta-line">
                <span><strong>Primary Building:</strong> ${escapeHtml(item.location)}</span>
                <span><strong>Registered:</strong> ${escapeHtml(item.date || 'Recently')}</span>
              ${cleanFinderInstructions(item.instructions) ? `<span><strong>Finder Instructions:</strong> ${escapeHtml(cleanFinderInstructions(item.instructions))}</span>` : ''}
              </div>

              <div class="card-actions" style="margin-top: 1rem;">
                ${currentUser?.role === 'admin' ? `<button class="btn-sm btn-qr" onclick="openQrStickerModal(${item.id})">QR Sticker</button>` : ''}
                ${currentUser?.role === 'admin' ? `<button class="btn-sm btn-outline" style="border-color: rgba(34,197,94,0.4); color: #86efac;" onclick="openAnonymousFinderModal('${escapeHtml(item.refCode)}')">Test Finder Screen</button>` : ''}
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

        const claimBtnText = item.claimed ? 'Mark Unclaimed' : 'Mark Claimed';

        // Check for smart matches
        const match = findMatch(item, items);
        let matchBadgeHtml = '';
        if (match) {
          matchBadgeHtml = `<button type="button" class="btn-match-qr potential-match-badge" onclick="openMatchQrModal(${item.id}, ${match.id})"><span class="potential-match-shimmer" aria-hidden="true"></span><svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fde68a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z"/></svg><span class="potential-match-label">Potential Match</span></button>`;
        }
        const verificationHtml = item.verification ? `
          <span><strong>Verification Hint:</strong> ${escapeHtml(item.verification)}</span>
        ` : '';

        const photoHtml = `
          <div class="item-photo-container">
            <div class="item-photo-frame" ${item.photo ? `role="button" tabindex="0" onclick="openImageModal('${escapeHtml(item.photo)}', '${escapeHtml(item.title)}')" onkeydown="if(event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openImageModal('${escapeHtml(item.photo)}', '${escapeHtml(item.title)}'); }"` : ''}>
              ${item.photo ? `<img src="${item.photo}" alt="${escapeHtml(item.title)}" />` : '<span>No photo uploaded</span>'}
            </div>
            ${matchBadgeHtml}
          </div>
        `;

        return `
          <div class="project-card" id="item-card-${item.id}">
            <div class="project-card-header">
              <div class="item-card-header-content">
                <div class="item-card-meta-row">
                  <div class="item-card-category-ref">
                    <span class="project-type" title="${escapeHtml(item.category)}">${escapeHtml(item.category)}</span>
                    <span class="ref-code" title="${escapeHtml(item.refCode || '')}">${escapeHtml(item.refCode || '')}</span>
                  </div>
                  ${badgeHtml}
                </div>
                <h3 style="margin-top: 0.35rem;">${escapeHtml(item.title)}</h3>
              </div>
            </div>

            ${photoHtml}

            <p class="item-card-description" style="margin-top: 0.25rem;">${escapeHtml(item.desc)}</p>

            <div class="card-meta-line">
              <span><strong>Location:</strong> ${escapeHtml(item.location)}</span>
              <span><strong>Contact:</strong> ${escapeHtml(item.contact)}</span>
              <span><strong>Date:</strong> ${escapeHtml(item.date || 'Recently')}${item.createdAt ? ` <span style="color:var(--text-muted);font-size:0.72rem;">· ${timeAgo(item.createdAt)}</span>` : ''}</span>
              ${verificationHtml}
            </div>

            <div class="card-actions">
              ${currentUser?.role === 'admin' ? `<button class="btn-sm btn-del" onclick="deleteItem(${item.id})">Remove</button>` : ''}
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
      renderItems();
      document.getElementById('items').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // FEATURE: Digital "Found" QR Code Stickers (Preventive Add-on Feature)
    function openQrStickerModal(id) {
      const item = getItems().find(i => i.id === id);
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
      document.getElementById('registerBelongingModal').classList.add('open');
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

    function handleRegisterBelongingSubmit(e) {
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

      const items = getItems();
      const nextNum = items.length + 1;
      const refCode = `CSPC-REG-QR-${String(nextNum).padStart(4, '0')}`;

      const newBelonging = {
        id: Date.now(),
        refCode,
        title,
        category,
        type: 'registered',
        location,
        locationDetails: identifiers,
        instructions: instructions || '',
        contact: 'Verified CSPC Account',
        desc: identifiers ? `Valuable belonging: ${identifiers}` : 'Valuable personal belonging registered in student vault.',
        verification: identifiers || 'Registered by verified CSPC account',
        photo: '',
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        status: 'registered',
        claimed: false,
        notifications: [],
        createdAt: new Date().toISOString()
      };

      items.unshift(newBelonging);
      saveItems(items);

      closeRegisterBelongingModal();
      showToast('✅ Belonging registered! Your QR sticker is ready.');

      // Open QR sticker modal
      openQrStickerModal(newBelonging.id);
      renderItems();
    }

    // ── Anonymous Finder Modal ────────────────────────────────────────────────
    function openAnonymousFinderModal(refCode) {
      const items = getItems();
      const item = items.find(i => (i.refCode && i.refCode.toUpperCase() === refCode.toUpperCase()) || String(i.id) === refCode);
      if (!item) {
        showToast('Could not load item info. Invalid QR code.', 'error');
        return;
      }

      document.getElementById('finderScreenItemTitle').textContent = item.title;
      document.getElementById('finderScreenRefCode').textContent = item.refCode;
      const instructionsElement = document.getElementById('finderScreenInstructions');
      instructionsElement.textContent = String(item.instructions || '')
        .replace(/If found, please (notify owner via QR or )?leave with CSPC SASO \/ Campus Security(?: Desk)?\.?/gi, '')
        .trim();
      instructionsElement.style.display = instructionsElement.textContent ? '' : 'none';
      document.getElementById('finderRefCodeInput').value = item.refCode;
      document.getElementById('finderMessageInput').value = '';
      document.getElementById('finderLocationInput').value = '';
      document.getElementById('finderContactInput').value = '';
      document.getElementById('anonymousFinderModal').classList.add('open');
    }

    function closeAnonymousFinderModal() {
      document.getElementById('anonymousFinderModal').classList.remove('open');
    }

    function handleAnonymousFinderSubmit(e) {
      e.preventDefault();
      const refCode       = document.getElementById('finderRefCodeInput').value;
      const message       = document.getElementById('finderMessageInput').value.trim();
      const locationFound = document.getElementById('finderLocationInput').value.trim();
      const finderContact = document.getElementById('finderContactInput').value.trim();

      if (!message) {
        showToast('Please describe where and how you found the item.', 'error');
        return;
      }

      const items = getItems();
      const item = items.find(i => i.refCode && i.refCode.toUpperCase() === refCode.toUpperCase());
      if (item) {
        if (!item.notifications) item.notifications = [];
        item.notifications.unshift({
          id: 'notif-' + Date.now(),
          refCode: item.refCode,
          itemTitle: item.title,
          message,
          locationFound: locationFound || 'Campus area',
          finderContact: finderContact || 'Anonymous Student / Finder',
          timestamp: new Date().toISOString(),
          read: false
        });
        saveItems(items);
        updateNotifBadge();
      }

      showToast('📲 Anonymous alert delivered to the owner\'s account!');
      closeAnonymousFinderModal();
    }

    // ── Match QR Modal ────────────────────────────────────────────────────────
    function openMatchQrModal(lostId, foundId) {
      const items = getItems();
      const first = items.find(i => i.id === lostId) || {};
      const second = items.find(i => i.id === foundId) || {};
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
    }

    function closeMatchQrModal() {
      document.getElementById('matchQrModal').classList.remove('open');
    }

    function printMatchQr() {
      window.print();
    }

    // ── Notifications Modal ───────────────────────────────────────────────────
    function openNotificationsModal() {
      document.getElementById('notificationsModal').classList.add('open');
      loadNotificationsIntoModal();
    }

    function closeNotificationsModal() {
      document.getElementById('notificationsModal').classList.remove('open');
    }

    function loadNotificationsIntoModal() {
      const list = document.getElementById('notificationsList');
      const items = getItems();
      const notifications = [];

      items.forEach(i => {
        if (i.notifications && Array.isArray(i.notifications)) {
          i.notifications.forEach(n => {
            notifications.push({
              ...n,
              itemId: i.id,
              itemTitle: i.title,
              refCode: i.refCode
            });
          });
        }
      });

      notifications.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      if (!notifications.length) {
        list.innerHTML = '<p style="text-align:center;color:#888;padding:24px;">No finder alerts yet. When someone scans your QR sticker, you\'ll see their message here.</p>';
        return;
      }

      list.innerHTML = notifications.map(n => `
        <div class="notif-item${n.read ? '' : ' unread'}" data-id="${n.id}">
          <div class="notif-header">
            <strong>🏷️ ${n.itemTitle || n.refCode}</strong>
            <span class="notif-time">${new Date(n.timestamp).toLocaleString()}</span>
          </div>
          <p class="notif-msg">📍 <em>${n.locationFound || 'Location not specified'}</em></p>
          <p class="notif-msg">💬 ${n.message}</p>
          ${n.finderContact && n.finderContact !== 'Anonymous Student / Finder'
            ? `<p class="notif-contact">📞 Finder left optional contact: ${n.finderContact}</p>`
            : '<p class="notif-contact">🔒 Finder remained anonymous</p>'}
          ${!n.read ? `<button class="btn-mark-read" onclick="markNotifRead('${n.id}', this)">Mark as read</button>` : ''}
        </div>
      `).join('');

      updateNotifBadge();
    }

    function markNotifRead(notifId, btn) {
      const items = getItems();
      items.forEach(i => {
        if (i.notifications) {
          const n = i.notifications.find(notif => notif.id === notifId);
          if (n) n.read = true;
        }
      });
      saveItems(items);
      const itemEl = btn.closest('.notif-item');
      if (itemEl) itemEl.classList.remove('unread');
      btn.remove();
      updateNotifBadge();
    }

    function updateNotifBadge() {
      const items = getItems();
      let unread = 0;
      items.forEach(i => {
        if (i.notifications) {
          unread += i.notifications.filter(n => !n.read).length;
        }
      });
      const badge = document.getElementById('notifCountBadge');
      if (badge) {
        badge.textContent = unread;
        badge.style.display = unread > 0 ? 'inline-flex' : 'none';
      }
    }

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

    let currentPhotoBase64 = '';

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
        showToast('Image file size must be less than 5MB.', true);
        document.getElementById('itemPhotoInput').value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = function(evt) {
        currentPhotoBase64 = evt.target.result;
        document.getElementById('photoPreviewImg').src = currentPhotoBase64;
        document.getElementById('photoPreviewMeta').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
        document.getElementById('photoPreviewBox').style.display = 'flex';
      };
      reader.readAsDataURL(file);
    }

    function removePhoto() {
      currentPhotoBase64 = '';
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

    function handleFormSubmit(e) {
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

      const items = getItems();
      const nextNum = items.length + 1;
      const refCode = "CSPC-LF-2026-" + String(nextNum).padStart(3, '0');

      const newItem = {
        id: Date.now(),
        refCode,
        title,
        category,
        type,
        location,
        contact,
        desc,
        verification,
        photo: currentPhotoBase64,
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        claimed: false
      };

      items.unshift(newItem);
      saveItems(items);
      removePhoto();

      // Check if new report matches any existing item
      const match = findMatch(newItem, items);

      // Reset form
      document.getElementById('itemForm').reset();
      updateTypeRadio();
      renderItems();

      openReportSuccessModal(refCode, newItem.id, match);

      // Scroll to items
      document.getElementById('items').scrollIntoView({ behavior: 'smooth' });
    }

    let targetDeleteId = null;
    let targetClaimId = null;
    let lastCreatedItemId = null;

    function openReportSuccessModal(refCode, itemId, match) {
      lastCreatedItemId = itemId;
      document.getElementById('successRefCode').innerText = refCode || 'CSPC-LF-2026';

      const matchAlert = document.getElementById('successMatchAlert');
      if (false && match) {
        matchAlert.style.display = 'block';
        matchAlert.innerHTML = `🎯 <strong>Potential Smart Match Detected!</strong> Matching ${match.type} item "${escapeHtml(match.title)}" (${escapeHtml(match.location)}) found.`;
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
      const items = getItems();
      const item = items.find(i => i.id === id);
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

    function executeDelete() {
      if (!targetDeleteId) return;
      const id = targetDeleteId;
      closeDeleteModal();

      let items = getItems();
      items = items.filter(i => i.id !== id);
      saveItems(items);
      renderItems();
      showToast('Item removed.');
    }

    function deleteItem(id) {
      openDeleteModal(id);
    }

    function openClaimModal(id) {
      const items = getItems();
      const item = items.find(i => i.id === id);
      if (!item) return;
      targetClaimId = id;

      const titleEl = document.getElementById('claimModalTitle');
      const subtitleEl = document.getElementById('claimModalSubtitle');
      const hintBox = document.getElementById('claimVerificationBox');
      const hintText = document.getElementById('claimModalHint');
      const proofGroup = document.getElementById('claimProofGroup');
      const proofInput = document.getElementById('claimProofInput');
      const btnEl = document.getElementById('claimModalBtn');

      proofInput.value = '';

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
      targetClaimId = null;
    }

    function executeClaimToggle() {
      if (!targetClaimId) return;
      const id = targetClaimId;
      closeClaimModal();

      const items = getItems();
      const item = items.find(i => i.id === id);
      if (item) {
        item.claimed = !item.claimed;
        saveItems(items);
        renderItems();
        showToast(item.claimed ? `Item ${item.refCode || ''} marked as claimed.` : 'Status restored to active.');
      }
    }

    function toggleClaim(id) {
      openClaimModal(id);
    }

    function timeAgo(isoStr) {
      if (!isoStr) return '';
      const diff  = Date.now() - new Date(isoStr).getTime();
      const mins  = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days  = Math.floor(diff / 86400000);
      if (mins < 1)   return 'Just now';
      if (mins < 60)  return `${mins}m ago`;
      if (hours < 24) return `${hours}h ago`;
      if (days < 30)  return `${days}d ago`;
      return new Date(isoStr).toLocaleDateString();
    }

    function cleanFinderInstructions(value) {
      return String(value || '')
        .replace(/\s*If found, please (notify owner via QR or )?leave with CSPC SASO \/ Campus Security(?: Desk)?\.?/gi, '')
        .trim();
    }

    function escapeHtml(str) {
      if (!str) return '';
      return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[tag] || tag));
    }

    function showToast(msg) {
      const old = document.querySelector('.toast');
      if (old) old.remove();
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.innerText = msg;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3200);
    }

    // Mobile nav toggle


    // Theme toggle






    // Initial render
    document.addEventListener('DOMContentLoaded', () => {
      checkAuthSession();
      renderItems();
      updateNotifBadge();

    });

let currentItem = null;

    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('navMount').innerHTML = renderNav('browse.html');
      initNav();

      const id = getQueryParam('id');
      if (!id) { showNotFound(); return; }

      currentItem = getItemById(id);
      if (!currentItem) { showNotFound(); return; }

      renderDetail(currentItem);

      // Modal controls
      document.getElementById('closeModal').addEventListener('click',  closeModal);
      document.getElementById('cancelClaim').addEventListener('click', closeModal);
      document.getElementById('claimModal').addEventListener('click', e => {
        if (e.target === document.getElementById('claimModal')) closeModal();
      });
      document.getElementById('submitClaim').addEventListener('click', submitClaim);
    });

    function renderDetail(item) {
      document.title = 'Back2You';
      document.getElementById('breadcrumbTitle').textContent = item.title;

      const dateLabel   = item.type === 'lost'
        ? `<div class="detail-row"><div class="detail-row-label">📅 Date Lost</div><div class="detail-row-value">${formatDate(item.dateLost)}</div></div>`
        : `<div class="detail-row"><div class="detail-row-label">📅 Date Found</div><div class="detail-row-value">${formatDate(item.dateFound)}</div></div>`;

      const photoUrl = (item.imageUrl || item.photo) && item.id
        ? `/api/items/${encodeURIComponent(item.id)}/photo`
        : (item.imageUrl || item.photo || '');
      const imageBlock = photoUrl
        ? `<img src="${photoUrl}" class="detail-image" alt="${escHtml(item.title)}" onerror="this.style.display='none'">`
        : `<div class="detail-image-placeholder">${categoryIcon(item.category)}</div>`;

      const canClaim = item.status !== 'claimed';
      const claimBtnHtml = canClaim
        ? `<button class="btn btn-primary" id="openClaimBtn" style="width:100%">🤝 Submit a Claim</button>`
        : `<div class="claimed-banner">✅ This item has been claimed</div>`;

      const relatedItems = getItems()
        .filter(i => i.category === item.category && i.id !== item.id && i.status !== 'claimed')
        .slice(0, 3);

      const relatedHtml = relatedItems.length > 0 ? `
        <div class="sidebar-card">
          <div class="sidebar-card-title">Similar Items</div>
          <div style="display:flex;flex-direction:column;gap:.75rem;">
            ${relatedItems.map(r => `
              <a href="item-detail.html?id=${r.id}" style="text-decoration:none;display:flex;gap:.6rem;align-items:center;padding:.5rem;border-radius:8px;transition:background .2s;" onmouseover="this.style.background='rgba(59,130,246,0.06)'" onmouseout="this.style.background=''">
                <div style="font-size:1.4rem;flex-shrink:0;">${categoryIcon(r.category)}</div>
                <div>
                  <div style="font-size:.82rem;font-weight:700;color:var(--text-main);line-height:1.2;">${escHtml(r.title)}</div>
                  <div style="font-size:.72rem;color:var(--text-muted);">${r.type === 'lost' ? '🔍 Lost' : '📦 Found'} · ${escHtml(r.location)}</div>
                </div>
              </a>
            `).join('')}
          </div>
        </div>` : '';

      document.getElementById('detailMount').innerHTML = `
        <div class="detail-layout">
          <!-- Main card -->
          <div>
            <div class="detail-card">
              ${imageBlock}
              <div class="detail-body">
                <div class="detail-badges">
                  ${typeBadge(item.type)}
                  ${statusBadge(item.status)}
                </div>
                <h1 class="detail-title">${escHtml(item.title)}</h1>
                <div class="detail-category">${categoryIcon(item.category)} ${escHtml(item.category)}</div>

                <div class="detail-row"><div class="detail-row-label">📍 Location</div><div class="detail-row-value">${escHtml(item.location)}</div></div>
                ${dateLabel}
                <div class="detail-row"><div class="detail-row-label">🕐 Reported</div><div class="detail-row-value">${formatDate(item.createdAt)} (${timeAgo(item.createdAt)})</div></div>
                <div class="detail-row" style="align-items:flex-start;"><div class="detail-row-label">📝 Description</div><div class="detail-row-value">${escHtml(item.description)}</div></div>
              </div>
            </div>

            <!-- Status Timeline -->
            <div class="sidebar-card" style="margin-top:1rem;">
              <div class="sidebar-card-title">Status History</div>
              <div class="status-timeline">
                <div class="st-item">
                  <div class="st-dot">1</div>
                  <div class="st-info">
                    <div class="st-label">${item.type === 'lost' ? 'Reported as Lost' : 'Reported as Found'}</div>
                    <div class="st-time">${formatDate(item.createdAt)} · ${timeAgo(item.createdAt)}</div>
                  </div>
                </div>
                ${item.status === 'claimed' ? `
                <div class="st-item">
                  <div class="st-dot">2</div>
                  <div class="st-info">
                    <div class="st-label" style="color:#4ade80;">Marked as Claimed</div>
                    <div class="st-time">${formatDate(item.updatedAt || item.createdAt)}</div>
                  </div>
                </div>` : ''}
              </div>
            </div>
          </div>

          <!-- Sidebar -->
          <div>
            <!-- Claim action -->
            <div class="sidebar-card">
              <div class="sidebar-card-title">${item.type === 'lost' ? 'Found This Item?' : 'Is This Yours?'}</div>
              <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:1rem;line-height:1.6;">
                ${item.type === 'lost'
                  ? 'If you have found this item, click below to contact the owner.'
                  : 'If this item belongs to you, submit a claim and we will connect you with the finder.'}
              </p>
              ${claimBtnHtml}
            </div>

            <!-- Reporter contact -->
            <div class="sidebar-card">
              <div class="sidebar-card-title">Reporter Information</div>
              <div class="contact-row">
                <div class="contact-row-icon">👤</div>
                <div class="contact-row-text"><strong>Name</strong>${escHtml(item.reporterName)}</div>
              </div>
              <div class="contact-row">
                <div class="contact-row-icon">📞</div>
                <div class="contact-row-text"><strong>Contact</strong>${escHtml(item.reporterContact)}</div>
              </div>
              ${item.reporterEmail ? `
              <div class="contact-row">
                <div class="contact-row-icon">✉️</div>
                <div class="contact-row-text"><strong>Email</strong><a href="mailto:${escHtml(item.reporterEmail)}" style="color:var(--blue-main);text-decoration:none;">${escHtml(item.reporterEmail)}</a></div>
              </div>` : ''}
            </div>

            ${relatedHtml}

            <div style="text-align:center;margin-top:.5rem;">
              <a href="browse.html" style="font-size:.8rem;color:var(--text-muted);text-decoration:none;" onmouseover="this.style.color='#3b82f6'" onmouseout="this.style.color=''">← Back to Browse</a>
            </div>
          </div>
        </div>
      `;

      // Attach claim button
      const claimBtn = document.getElementById('openClaimBtn');
      if (claimBtn) claimBtn.addEventListener('click', openModal);
    }

    function showNotFound() {
      document.getElementById('detailMount').innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">❓</div>
          <h3>Item Not Found</h3>
          <p>This item may have been removed or the link is invalid.</p>
          <a href="browse.html" class="btn btn-primary" style="margin-top:1rem;">Browse All Items</a>
        </div>`;
    }

    function openModal() {
      document.getElementById('claimModal').classList.add('open');
    }
    function closeModal() {
      document.getElementById('claimModal').classList.remove('open');
    }

    function submitClaim() {
      const name    = document.getElementById('claimName').value.trim();
      const contact = document.getElementById('claimContact').value.trim();
      const email   = document.getElementById('claimEmail').value.trim();
      const proof   = document.getElementById('claimProof').value.trim();

      if (!name || !contact || !proof) {
        showToast('Please fill in all required fields.', 'error');
        return;
      }

      addClaim({
        itemId:    currentItem.id,
        itemTitle: currentItem.title,
        claimerName:    name,
        claimerContact: contact,
        claimerEmail:   email,
        proof,
      });

      closeModal();
      showToast(`Claim submitted for "${currentItem.title}". The reporter will contact you.`);

      // Clear form
      ['claimName','claimContact','claimEmail','claimProof'].forEach(id => {
        document.getElementById(id).value = '';
      });
    }

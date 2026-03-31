// history.js — Screenshot gallery logic

document.addEventListener('DOMContentLoaded', () => {
  const gallery = document.getElementById('gallery');
  const emptyState = document.getElementById('empty-state');
  const historyCount = document.getElementById('history-count');
  const btnClearAll = document.getElementById('btn-clear-all');
  const previewModal = document.getElementById('preview-modal');
  const modalImage = document.getElementById('modal-image');
  const modalInfo = document.getElementById('modal-info');
  const modalOpen = document.getElementById('modal-open');
  const modalClose = document.getElementById('modal-close');
  const modalLoading = previewModal.querySelector('.modal-loading');

  let currentPreviewId = null;

  // ─── Load History ─────────────────────────────────────
  loadHistory();

  function loadHistory() {
    chrome.runtime.sendMessage({ action: 'getHistory' }, (response) => {
      if (chrome.runtime.lastError) {
        historyCount.textContent = 'Failed to load history';
        return;
      }

      const history = response?.history || [];

      if (history.length === 0) {
        gallery.style.display = 'none';
        emptyState.style.display = 'flex';
        historyCount.textContent = 'No screenshots';
        btnClearAll.style.display = 'none';
        return;
      }

      historyCount.textContent = `${history.length} screenshot${history.length !== 1 ? 's' : ''}`;
      renderGallery(history);
    });
  }

  function renderGallery(history) {
    gallery.innerHTML = '';
    let lastDate = '';

    history.forEach((item) => {
      // Date separator
      const itemDate = formatDate(item.timestamp);
      if (itemDate !== lastDate) {
        const sep = document.createElement('div');
        sep.className = 'date-separator';
        sep.innerHTML = `<span>${itemDate}</span>`;
        gallery.appendChild(sep);
        lastDate = itemDate;
      }

      const card = createCard(item);
      gallery.appendChild(card);
    });
  }

  function createCard(item) {
    const card = document.createElement('div');
    card.className = 'gallery-card';
    card.dataset.captureId = item.captureId;

    let hostname = 'Unknown';
    try {
      hostname = new URL(item.pageUrl).hostname;
    } catch (e) {}

    const timeStr = new Date(item.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    card.innerHTML = `
      <div class="card-thumbnail">
        <div class="loading-thumb">Loading...</div>
        <div class="card-overlay">
          <button class="card-btn open" title="Open in viewer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </button>
          <button class="card-btn delete" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="card-info">
        <div class="card-url" title="${item.pageUrl}">${hostname}</div>
        <div class="card-meta">
          <span>🕐 ${timeStr}</span>
        </div>
      </div>
    `;

    // Load actual thumbnail from stored capture
    loadThumbnail(card, item.captureId);

    // Click on card => preview
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-btn')) return; // Don't trigger on button clicks
      openPreview(item);
    });

    // Open button
    card.querySelector('.card-btn.open').addEventListener('click', (e) => {
      e.stopPropagation();
      openInViewer(item.captureId);
    });

    // Delete button
    card.querySelector('.card-btn.delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteCapture(item.captureId, card);
    });

    return card;
  }

  function loadThumbnail(card, captureId) {
    const captureKey = 'capture_' + captureId;
    chrome.storage.local.get(captureKey, (result) => {
      const thumbContainer = card.querySelector('.card-thumbnail');
      const loadingEl = thumbContainer.querySelector('.loading-thumb');

      if (result[captureKey] && result[captureKey].imageDataUrl) {
        const img = document.createElement('img');
        img.src = result[captureKey].imageDataUrl;
        img.alt = 'Screenshot thumbnail';
        img.onload = () => {
          if (loadingEl) loadingEl.style.display = 'none';
        };
        img.onerror = () => {
          if (loadingEl) loadingEl.textContent = 'Failed to load';
        };
        thumbContainer.insertBefore(img, thumbContainer.firstChild);
      } else {
        if (loadingEl) loadingEl.textContent = 'Image not available';
      }
    });
  }

  // ─── Preview Modal ────────────────────────────────────
  function openPreview(item) {
    currentPreviewId = item.captureId;
    previewModal.style.display = 'block';
    modalImage.style.display = 'none';
    modalLoading.style.display = 'flex';

    let hostname = 'Unknown';
    try {
      hostname = new URL(item.pageUrl).hostname;
    } catch (e) {}
    const dateStr = new Date(item.timestamp).toLocaleString();
    modalInfo.textContent = `${hostname} • ${dateStr}`;

    const captureKey = 'capture_' + item.captureId;
    chrome.storage.local.get(captureKey, (result) => {
      if (result[captureKey] && result[captureKey].imageDataUrl) {
        modalImage.src = result[captureKey].imageDataUrl;
        modalImage.onload = () => {
          modalLoading.style.display = 'none';
          modalImage.style.display = 'block';
        };
      } else {
        modalLoading.querySelector('p').textContent = 'Image not available';
        modalLoading.querySelector('.spinner').style.display = 'none';
      }
    });

    // Prevent body scroll
    document.body.style.overflow = 'hidden';
  }

  function closePreview() {
    previewModal.style.display = 'none';
    modalImage.src = '';
    currentPreviewId = null;
    document.body.style.overflow = '';
  }

  modalClose.addEventListener('click', closePreview);
  previewModal.querySelector('.modal-backdrop').addEventListener('click', closePreview);

  modalOpen.addEventListener('click', () => {
    if (currentPreviewId) {
      openInViewer(currentPreviewId);
      closePreview();
    }
  });

  // ESC to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && previewModal.style.display === 'block') {
      closePreview();
    }
  });

  // ─── Actions ──────────────────────────────────────────
  function openInViewer(captureId) {
    chrome.runtime.sendMessage({ action: 'loadCapture', captureId }, (response) => {
      if (response && response.success) {
        chrome.tabs.create({ url: 'page.html' });
      }
    });
  }

  function deleteCapture(captureId, cardEl) {
    cardEl.style.opacity = '0.3';
    cardEl.style.pointerEvents = 'none';

    chrome.runtime.sendMessage({ action: 'deleteCapture', captureId }, () => {
      cardEl.style.transition = 'all 0.3s ease';
      cardEl.style.transform = 'scale(0.9)';
      cardEl.style.opacity = '0';
      setTimeout(() => {
        cardEl.remove();
        // Check if gallery is now empty
        if (gallery.querySelectorAll('.gallery-card').length === 0) {
          gallery.style.display = 'none';
          emptyState.style.display = 'flex';
          historyCount.textContent = 'No screenshots';
          btnClearAll.style.display = 'none';
        } else {
          const remaining = gallery.querySelectorAll('.gallery-card').length;
          historyCount.textContent = `${remaining} screenshot${remaining !== 1 ? 's' : ''}`;
        }
      }, 300);
    });
  }

  btnClearAll.addEventListener('click', () => {
    if (!confirm('Delete all screenshot history? This cannot be undone.')) return;

    chrome.runtime.sendMessage({ action: 'clearHistory' }, () => {
      gallery.innerHTML = '';
      gallery.style.display = 'none';
      emptyState.style.display = 'flex';
      historyCount.textContent = 'No screenshots';
      btnClearAll.style.display = 'none';
    });
  });

  // ─── Utilities ────────────────────────────────────────
  function formatDate(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
    });
  }
});

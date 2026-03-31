// page.js — Result viewer tab logic

document.addEventListener('DOMContentLoaded', () => {
  const screenshot = document.getElementById('screenshot');
  const imageWrapper = document.getElementById('image-wrapper');
  const loading = document.getElementById('loading');
  const emptyState = document.getElementById('empty-state');
  const pageInfo = document.getElementById('page-info');
  const formatSelect = document.getElementById('format-select');
  const qualityGroup = document.getElementById('quality-group');
  const qualitySlider = document.getElementById('quality-slider');
  const qualityValue = document.getElementById('quality-value');
  const pdfGroup = document.getElementById('pdf-group');
  const pdfSize = document.getElementById('pdf-size');
  const pdfOrientation = document.getElementById('pdf-orientation');
  const btnDownload = document.getElementById('btn-download');
  const btnCopy = document.getElementById('btn-copy');
  const btnRecapture = document.getElementById('btn-recapture');
  const btnHistory = document.getElementById('btn-history');

  let captureData = null;
  let autoDownloadTriggered = false;
  let viewerSettings = {
    format: 'png',
    jpegQuality: 92,
    pdfSize: 'a4',
    pdfOrientation: 'portrait',
    autoDownload: false,
    includeUrl: true,
    includeTimestamp: true,
  };

  chrome.storage.sync.get(viewerSettings, (settings) => {
    viewerSettings = settings;
    applyViewerSettings();
  });

  // ─── Load Screenshot ──────────────────────────────────
  chrome.storage.local.get('lastCapture', (result) => {
    if (result.lastCapture && result.lastCapture.imageDataUrl) {
      captureData = result.lastCapture;
      screenshot.src = captureData.imageDataUrl;

      screenshot.onload = () => {
        loading.style.display = 'none';
        imageWrapper.style.display = 'block';

        // Show page info
        const url = captureData.pageUrl || 'Unknown page';
        const date = new Date(captureData.timestamp).toLocaleString();
        const dims = `${screenshot.naturalWidth}×${screenshot.naturalHeight}`;
        pageInfo.textContent = `${url} • ${dims} • ${date}`;
        document.title = `ScreenFullPage — ${url}`;

        maybeAutoDownload();
      };

      screenshot.onerror = () => {
        loading.style.display = 'none';
        emptyState.style.display = 'flex';
      };
    } else {
      loading.style.display = 'none';
      emptyState.style.display = 'flex';
    }
  });

  // ─── Format Selection ─────────────────────────────────
  formatSelect.addEventListener('change', () => {
    const format = formatSelect.value;
    qualityGroup.style.display = format === 'jpeg' ? 'flex' : 'none';
    pdfGroup.style.display = format === 'pdf' ? 'flex' : 'none';
  });

  qualitySlider.addEventListener('input', () => {
    qualityValue.textContent = qualitySlider.value + '%';
  });

  // ─── Download ─────────────────────────────────────────
  btnDownload.addEventListener('click', () => {
    if (!captureData) return;
    const format = formatSelect.value;

    if (format === 'pdf') {
      downloadPDF();
    } else {
      downloadImage(format);
    }
  });

  function downloadImage(format) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = screenshot.naturalWidth;
    canvas.height = screenshot.naturalHeight;
    ctx.drawImage(screenshot, 0, 0);

    let mimeType = 'image/png';
    let extension = 'png';
    let quality = undefined;

    if (format === 'jpeg') {
      mimeType = 'image/jpeg';
      extension = 'jpg';
      quality = parseInt(qualitySlider.value, 10) / 100;

      // Fill white background for JPEG (no transparency)
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.fillStyle = '#FFFFFF';
      tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
      tempCtx.drawImage(canvas, 0, 0);

      tempCanvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        triggerDownloadBlob(url, getFilename(extension));
      }, mimeType, quality);
      return;
    }

    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      triggerDownloadBlob(url, getFilename(extension));
    }, mimeType, quality);
  }

  function downloadPDF() {
    if (typeof window.jspdf === 'undefined') {
      showToast('PDF library not loaded', 'error');
      return;
    }

    const { jsPDF } = window.jspdf;
    const orientation = pdfOrientation.value === 'landscape' ? 'l' : 'p';
    const paperSize = pdfSize.value;

    const doc = new jsPDF({
      orientation,
      unit: 'mm',
      format: paperSize,
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 5; // mm

    const availableWidth = pageWidth - margin * 2;
    const availableHeight = pageHeight - margin * 2;

    // Calculate image dimensions to fit page width
    const imgWidth = availableWidth;
    const imgHeight = (screenshot.naturalHeight / screenshot.naturalWidth) * imgWidth;

    if (imgHeight <= availableHeight) {
      // Fits on one page
      doc.addImage(captureData.imageDataUrl, 'PNG', margin, margin, imgWidth, imgHeight);
    } else {
      // Multi-page: split the image
      const totalPages = Math.ceil(imgHeight / availableHeight);

      for (let i = 0; i < totalPages; i++) {
        if (i > 0) doc.addPage();

        // Calculate source crop for this page
        const srcY = (i * availableHeight / imgHeight) * screenshot.naturalHeight;
        const srcHeight = (availableHeight / imgHeight) * screenshot.naturalHeight;
        const remainingSrcHeight = screenshot.naturalHeight - srcY;
        const actualSrcHeight = Math.min(srcHeight, remainingSrcHeight);

        // Create canvas for this page slice
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = screenshot.naturalWidth;
        sliceCanvas.height = Math.ceil(actualSrcHeight);
        const sliceCtx = sliceCanvas.getContext('2d');
        sliceCtx.drawImage(
          screenshot,
          0, Math.floor(srcY), screenshot.naturalWidth, Math.ceil(actualSrcHeight),
          0, 0, screenshot.naturalWidth, Math.ceil(actualSrcHeight)
        );

        const sliceData = sliceCanvas.toDataURL('image/png');
        const sliceImgHeight = (actualSrcHeight / screenshot.naturalWidth) * imgWidth;

        doc.addImage(sliceData, 'PNG', margin, margin, imgWidth, sliceImgHeight);
      }
    }

    const pdfBlob = doc.output('blob');
    const url = URL.createObjectURL(pdfBlob);
    triggerDownloadBlob(url, getFilename('pdf'));
  }

  // ─── Copy to Clipboard ────────────────────────────────
  btnCopy.addEventListener('click', async () => {
    if (!captureData) return;

    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = screenshot.naturalWidth;
      canvas.height = screenshot.naturalHeight;
      ctx.drawImage(screenshot, 0, 0);

      canvas.toBlob(async (blob) => {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob }),
          ]);
          showToast('Copied to clipboard! ✓', 'success');
        } catch (err) {
          showToast('Failed to copy', 'error');
        }
      }, 'image/png');
    } catch (err) {
      showToast('Failed to copy', 'error');
    }
  });

  // ─── Recapture ────────────────────────────────────────
  btnRecapture.addEventListener('click', () => {
    // Go back to previous tab and trigger capture
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        // Close the result tab
        const currentTabId = tabs[0].id;
        chrome.tabs.query({}, (allTabs) => {
          // Find a non-extension tab to activate
          const otherTab = allTabs.find(
            (t) => t.id !== currentTabId && !t.url.startsWith('chrome-extension://')
          );
          if (otherTab) {
            chrome.tabs.update(otherTab.id, { active: true }, () => {
              chrome.runtime.sendMessage({ action: 'startCapture' });
              chrome.tabs.remove(currentTabId);
            });
          }
        });
      }
    });
  });

  // ─── Keyboard Shortcut ────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      btnDownload.click();
    }
  });

  // ─── History ─────────────────────────────────────────
  if (btnHistory) {
    btnHistory.addEventListener('click', () => {
      chrome.tabs.create({ url: 'history.html' });
    });
  }

  // ─── Utilities ────────────────────────────────────────
  function getFilename(extension) {
    const url = captureData?.pageUrl || '';
    const parts = ['screenfullpage'];

    if (viewerSettings.includeUrl) {
      let hostname = 'screenshot';
      try {
        hostname = new URL(url).hostname.replace(/\./g, '_');
      } catch (e) {}
      parts.push(hostname);
    }

    if (viewerSettings.includeTimestamp) {
      const now = new Date();
      const timestamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0'),
      ].join('');
      parts.push(timestamp);
    }

    return `${parts.join('_')}.${extension}`;
  }

  function triggerDownloadBlob(url, filename) {
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast('Downloaded! ✓', 'success');
  }

  function showToast(message, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast show ' + type;
    setTimeout(() => {
      toast.className = 'toast';
    }, 2500);
  }

  function applyViewerSettings() {
    formatSelect.value = viewerSettings.format;
    qualitySlider.value = String(viewerSettings.jpegQuality);
    qualityValue.textContent = viewerSettings.jpegQuality + '%';
    pdfSize.value = viewerSettings.pdfSize;
    pdfOrientation.value = viewerSettings.pdfOrientation;
    qualityGroup.style.display = viewerSettings.format === 'jpeg' ? 'flex' : 'none';
    pdfGroup.style.display = viewerSettings.format === 'pdf' ? 'flex' : 'none';
    maybeAutoDownload();
  }

  function maybeAutoDownload() {
    if (!viewerSettings.autoDownload || autoDownloadTriggered || !captureData) {
      return;
    }
    if (!screenshot.complete || !screenshot.naturalWidth) {
      return;
    }

    autoDownloadTriggered = true;
    btnDownload.click();
  }
});

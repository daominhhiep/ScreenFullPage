// options.js — Settings page logic

document.addEventListener('DOMContentLoaded', () => {
  const optFormat = document.getElementById('opt-format');
  const optQuality = document.getElementById('opt-quality');
  const optQualityValue = document.getElementById('opt-quality-value');
  const optPdfSize = document.getElementById('opt-pdf-size');
  const optPdfOrientation = document.getElementById('opt-pdf-orientation');
  const optAutoDownload = document.getElementById('opt-auto-download');
  const optIncludeUrl = document.getElementById('opt-include-url');
  const optIncludeTimestamp = document.getElementById('opt-include-timestamp');
  const optDelay = document.getElementById('opt-delay');
  const optDelayValue = document.getElementById('opt-delay-value');
  const saveIndicator = document.getElementById('save-indicator');

  // Default settings
  const defaults = {
    format: 'png',
    jpegQuality: 92,
    pdfSize: 'a4',
    pdfOrientation: 'portrait',
    autoDownload: false,
    includeUrl: true,
    includeTimestamp: true,
    captureDelay: 150,
  };

  // ─── Load Settings ────────────────────────────────────
  chrome.storage.sync.get(defaults, (settings) => {
    optFormat.value = settings.format;
    optQuality.value = settings.jpegQuality;
    optQualityValue.textContent = settings.jpegQuality + '%';
    optPdfSize.value = settings.pdfSize;
    optPdfOrientation.value = settings.pdfOrientation;
    optAutoDownload.checked = settings.autoDownload;
    optIncludeUrl.checked = settings.includeUrl;
    optIncludeTimestamp.checked = settings.includeTimestamp;
    optDelay.value = settings.captureDelay;
    optDelayValue.textContent = settings.captureDelay + 'ms';
  });

  // ─── Save on Change ───────────────────────────────────
  function saveSettings() {
    const settings = {
      format: optFormat.value,
      jpegQuality: parseInt(optQuality.value),
      pdfSize: optPdfSize.value,
      pdfOrientation: optPdfOrientation.value,
      autoDownload: optAutoDownload.checked,
      includeUrl: optIncludeUrl.checked,
      includeTimestamp: optIncludeTimestamp.checked,
      captureDelay: parseInt(optDelay.value),
    };

    chrome.storage.sync.set(settings, () => {
      showSaveIndicator();
    });
  }

  // ─── Event Listeners ──────────────────────────────────
  optFormat.addEventListener('change', saveSettings);
  optPdfSize.addEventListener('change', saveSettings);
  optPdfOrientation.addEventListener('change', saveSettings);
  optAutoDownload.addEventListener('change', saveSettings);
  optIncludeUrl.addEventListener('change', saveSettings);
  optIncludeTimestamp.addEventListener('change', saveSettings);

  optQuality.addEventListener('input', () => {
    optQualityValue.textContent = optQuality.value + '%';
  });
  optQuality.addEventListener('change', saveSettings);

  optDelay.addEventListener('input', () => {
    optDelayValue.textContent = optDelay.value + 'ms';
  });
  optDelay.addEventListener('change', saveSettings);

  // ─── Save Indicator ───────────────────────────────────
  let saveTimeout;
  function showSaveIndicator() {
    clearTimeout(saveTimeout);
    saveIndicator.classList.add('show');
    saveTimeout = setTimeout(() => {
      saveIndicator.classList.remove('show');
    }, 2000);
  }
});

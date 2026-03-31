// popup.js — Popup UI controller

document.addEventListener('DOMContentLoaded', () => {
  const states = {
    ready: document.getElementById('state-ready'),
    capturing: document.getElementById('state-capturing'),
    error: document.getElementById('state-error'),
    complete: document.getElementById('state-complete'),
  };

  const btnCapture = document.getElementById('btn-capture');
  const btnRetry = document.getElementById('btn-retry');
  const btnOptions = document.getElementById('btn-options');
  const btnHistory = document.getElementById('btn-history');
  const progressText = document.getElementById('progress-text');
  const progressBar = document.getElementById('progress-bar');
  const errorMessage = document.getElementById('error-message');

  // ─── State Management ─────────────────────────────────
  function showState(name) {
    Object.values(states).forEach((el) => el.classList.remove('active'));
    if (states[name]) {
      states[name].classList.add('active');
    }
  }

  // ─── Event Listeners ──────────────────────────────────
  btnCapture.addEventListener('click', () => {
    startCapture();
  });

  btnRetry.addEventListener('click', () => {
    startCapture();
  });

  btnOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  btnHistory.addEventListener('click', () => {
    chrome.tabs.create({ url: 'history.html' });
  });

  // ─── Start Capture ────────────────────────────────────
  function startCapture() {
    showState('capturing');
    progressText.textContent = 'Preparing...';
    progressBar.style.width = '0%';

    chrome.runtime.sendMessage({ action: 'startCapture' }, (response) => {
      if (chrome.runtime.lastError) {
        showError('Could not start capture. Please try again.');
        return;
      }
      if (response && response.error) {
        showError(response.error);
      }
    });
  }

  // ─── Show Error ───────────────────────────────────────
  function showError(msg) {
    errorMessage.textContent = msg;
    showState('error');
  }

  // ─── Listen for Progress Updates ──────────────────────
  chrome.runtime.onMessage.addListener((message) => {
    switch (message.action) {
      case 'captureStarted':
        showState('capturing');
        break;

      case 'captureProgress':
        progressText.textContent = message.message || 'Capturing...';
        if (message.total > 0) {
          const percent = Math.round((message.current / message.total) * 100);
          progressBar.style.width = percent + '%';
        }
        break;

      case 'captureError':
        showError(message.error || 'Capture failed');
        break;

      case 'captureComplete':
        showState('complete');
        // Auto-close popup after 1.5s
        setTimeout(() => window.close(), 1500);
        break;
    }
  });

  // Check if capture is already in progress
  chrome.runtime.sendMessage({ action: 'getCaptureStatus' }, (response) => {
    if (response && response.inProgress) {
      showState('capturing');
    }
  });
});

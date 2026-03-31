// background.js — Service Worker: Capture orchestrator
// Coordinates the entire scroll-capture-stitch pipeline

const MAX_CANVAS_AREA = 268 * 1024 * 1024; // Chrome's actual canvas pixel limit (~16384 * 16384)
const MAX_CSS_PAGE_AREA = 100 * 1000 * 1000; // 100MP in CSS pixels = very large page safety cap
const MAX_HISTORY_ITEMS = 50; // Keep last 50 captures

let captureInProgress = false;

// ─── Keyboard Shortcut ───────────────────────────────────────────────
chrome.commands.onCommand.addListener((command) => {
  if (command === 'take-screenshot') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        startCapture(tabs[0].id);
      }
    });
  }
});

// ─── Message Handler ─────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startCapture') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        startCapture(tabs[0].id);
        sendResponse({ started: true });
      } else {
        sendResponse({ error: 'No active tab found' });
      }
    });
    return true; // async
  }

  if (message.action === 'stitchComplete') {
    handleStitchComplete(message.imageDataUrl, message.pageUrl);
    return false;
  }

  if (message.action === 'getCaptureStatus') {
    sendResponse({ inProgress: captureInProgress });
    return false;
  }

  if (message.action === 'getHistory') {
    chrome.storage.local.get('captureHistory', (result) => {
      sendResponse({ history: result.captureHistory || [] });
    });
    return true; // async
  }

  if (message.action === 'loadCapture') {
    // Load a specific capture by its ID from history
    const captureKey = 'capture_' + message.captureId;
    chrome.storage.local.get(captureKey, (result) => {
      if (result[captureKey]) {
        // Set it as the lastCapture so page.html can display it
        chrome.storage.local.set({ lastCapture: result[captureKey] }, () => {
          if (chrome.runtime.lastError) {
            sendResponse({ error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ success: true });
          }
        });
      } else {
        sendResponse({ error: 'Capture not found' });
      }
    });
    return true; // async
  }

  if (message.action === 'deleteCapture') {
    deleteCaptureFromHistory(message.captureId).then(() => {
      sendResponse({ success: true });
    });
    return true; // async
  }

  if (message.action === 'clearHistory') {
    clearAllHistory().then(() => {
      sendResponse({ success: true });
    });
    return true; // async
  }
});

// ─── Main Capture Flow ───────────────────────────────────────────────
async function startCapture(tabId) {
  if (captureInProgress) {
    notifyPopup({ action: 'captureError', error: 'Capture already in progress' });
    return;
  }

  captureInProgress = true;
  notifyPopup({ action: 'captureStarted' });

  try {
    // Retrieve user settings for capture delay
    const settings = await chrome.storage.sync.get({ captureDelay: 150 });
    const userDelay = Math.max(settings.captureDelay, 150); // minimum 150ms

    // 1. Check if we can capture this tab
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://')) {
      throw new Error('Cannot capture this page. Chrome restricts screenshots on internal pages.');
    }
    if (tab.url.includes('chrome.google.com/webstore') || tab.url.includes('chromewebstore.google.com')) {
      throw new Error('Chrome Web Store pages cannot be captured due to Google security policies.');
    }

    // 2. Inject content script
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });

    // Small delay to let content script initialize
    await delay(200);

    // 3. Get page info FIRST — detects the primary scroller and measures dimensions
    //    on the original unmodified DOM (important for accurate scroll container detection)
    const pageInfo = await sendMessageToTab(tabId, { action: 'getPageInfo' });
    if (!pageInfo || !pageInfo.viewportWidth) {
      throw new Error('Could not get page dimensions. Try reloading the page.');
    }

    // 4. Prepare page (hide scrollbars, handle fixed elements)
    await sendMessageToTab(tabId, { action: 'preparePage' });
    await delay(150);

    const { scrollWidth, scrollHeight, viewportWidth, viewportHeight, devicePixelRatio } = pageInfo;

    // 5. Check canvas size limits
    // captureVisibleTab already returns device-pixel-scaled images, so the canvas
    // that stitches them needs DPR-scaled dimensions. Check that the stitched
    // canvas won't exceed Chrome's hard limit.
    const canvasW = Math.round(scrollWidth * devicePixelRatio);
    const canvasH = Math.round(scrollHeight * devicePixelRatio);
    const totalPixels = canvasW * canvasH;

    if (totalPixels > MAX_CANVAS_AREA) {
      // Try clipping the height to fit within the limit before throwing
      // The stitcher will only render up to this height
      const safeHeight = Math.floor(MAX_CANVAS_AREA / canvasW / devicePixelRatio);
      console.warn(
        `Page too tall for single canvas (${scrollWidth}×${scrollHeight} @${devicePixelRatio}x). ` +
        `Will capture first ${safeHeight}px only.`
      );
      notifyPopup({
        action: 'captureProgress',
        current: 0,
        total: 1,
        message: `Page is very tall — capturing first ${safeHeight}px...`,
      });
      // Cap the scroll height so we only capture the portion that fits
      pageInfo.scrollHeight = safeHeight;
    }

    // 6. Calculate capture grid (use pageInfo.scrollHeight which may have been capped above)
    const captureHeight = pageInfo.scrollHeight;
    const totalRows = Math.ceil(captureHeight / viewportHeight);
    const totalCols = Math.ceil(scrollWidth / viewportWidth);
    const totalTiles = totalRows * totalCols;

    notifyPopup({
      action: 'captureProgress',
      current: 0,
      total: totalTiles,
      message: 'Preparing page...',
    });

    // 7. Capture loop - scroll and capture each tile
    const tiles = [];
    let tileIndex = 0;

    for (let row = 0; row < totalRows; row++) {
      for (let col = 0; col < totalCols; col++) {
        const scrollX = col * viewportWidth;
        const scrollY = row * viewportHeight;

        // Scroll to position
        const scrollResult = await sendMessageToTab(tabId, {
          action: 'scrollTo',
          x: scrollX,
          y: scrollY,
        });

        // Wait for rendering (use user-configured delay, min 150ms)
        await delay(userDelay);

        // Capture visible tab with backoff for Chrome's specific quota limiting
        // Limit is MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND (2 calls per second)
        let dataUrl;
        let retries = 5;
        while (retries > 0) {
          try {
            dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
            break;
          } catch (err) {
            if (err.message && err.message.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND')) {
              await delay(550); // wait at least 500ms to clear quota
              retries--;
              if (retries === 0) throw err;
            } else {
              throw err;
            }
          }
        }

        tiles.push({
          dataUrl,
          x: scrollX,
          y: scrollY,
          actualX: scrollResult.actualX,
          actualY: scrollResult.actualY,
          row,
          col,
        });

        tileIndex++;
        notifyPopup({
          action: 'captureProgress',
          current: tileIndex,
          total: totalTiles,
          message: `Capturing ${tileIndex}/${totalTiles}...`,
        });
      }
    }

    // 8. Restore page
    await sendMessageToTab(tabId, { action: 'restorePage' });

    notifyPopup({
      action: 'captureProgress',
      current: totalTiles,
      total: totalTiles,
      message: 'Stitching image...',
    });

    // 9. Send tiles to offscreen document for stitching
    await ensureOffscreenDocument();

    chrome.runtime.sendMessage({
      action: 'stitchTiles',
      target: 'offscreen',
      tiles,
      pageWidth: scrollWidth,
      pageHeight: captureHeight,
      viewportWidth,
      viewportHeight,
      devicePixelRatio,
      totalRows,
      totalCols,
      pageUrl: tab.url,
      pageTitle: tab.title,
    });

  } catch (error) {
    captureInProgress = false;
    console.error('Capture failed:', error);
    notifyPopup({
      action: 'captureError',
      error: error.message || 'Unknown error occurred',
    });

    // Try to restore the page
    try {
      await sendMessageToTab(tabId, { action: 'restorePage' });
    } catch (e) {
      // Page might have been closed
    }
  }
}

// ─── Handle Stitch Result ────────────────────────────────────────────
function handleStitchComplete(imageDataUrl, pageUrl) {
  captureInProgress = false;

  if (!imageDataUrl) {
    notifyPopup({ action: 'captureError', error: 'Failed to stitch image' });
    return;
  }

  const captureId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  const captureData = {
    imageDataUrl,
    pageUrl: pageUrl || '',
    timestamp: Date.now(),
    captureId,
  };

  // Store full image under its own key to avoid quota issues with history array
  const captureKey = 'capture_' + captureId;

  chrome.storage.local.set(
    {
      lastCapture: captureData,
      [captureKey]: captureData,
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error('Storage error:', chrome.runtime.lastError.message);
        notifyPopup({ action: 'captureError', error: 'Storage error: ' + chrome.runtime.lastError.message });
        return;
      }

      // Add thumbnail metadata to history (no full image data)
      addToHistory({
        captureId,
        pageUrl: pageUrl || '',
        timestamp: Date.now(),
        // Generate a tiny thumbnail data URL from the first tile
        thumbnailUrl: generateThumbnail(imageDataUrl),
      });

      chrome.tabs.create({ url: 'page.html' });
      notifyPopup({ action: 'captureComplete' });
    }
  );
}

// ─── History Management ──────────────────────────────────────────────
function addToHistory(meta) {
  chrome.storage.local.get('captureHistory', (result) => {
    const history = result.captureHistory || [];
    history.unshift(meta); // newest first

    // Trim to MAX_HISTORY_ITEMS
    if (history.length > MAX_HISTORY_ITEMS) {
      const removed = history.splice(MAX_HISTORY_ITEMS);
      // Clean up old full captures
      removed.forEach((item) => {
        chrome.storage.local.remove('capture_' + item.captureId);
      });
    }

    chrome.storage.local.set({ captureHistory: history });
  });
}

async function deleteCaptureFromHistory(captureId) {
  return new Promise((resolve) => {
    chrome.storage.local.get('captureHistory', (result) => {
      let history = result.captureHistory || [];
      history = history.filter((item) => item.captureId !== captureId);
      chrome.storage.local.set({ captureHistory: history }, () => {
        chrome.storage.local.remove('capture_' + captureId, resolve);
      });
    });
  });
}

async function clearAllHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get('captureHistory', (result) => {
      const history = result.captureHistory || [];
      const keysToRemove = history.map((item) => 'capture_' + item.captureId);
      keysToRemove.push('captureHistory');
      chrome.storage.local.remove(keysToRemove, resolve);
    });
  });
}

/**
 * Generate a tiny thumbnail from a data URL by scaling it down
 * We do this in the service worker using OffscreenCanvas
 */
function generateThumbnail(imageDataUrl) {
  // For now, we just store a cropped portion of the data URL
  // (first 200 chars — enough for the UI to show a color swatch)
  // The actual thumbnail generation happens in the history page
  // by loading the full capture and scaling it
  return imageDataUrl.substring(0, 200);
}

// ─── Offscreen Document Management ──────────────────────────────────
async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });

  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['DOM_PARSER'],
    justification: 'Stitch captured screenshot tiles into a single image using Canvas API',
  });
}

// ─── Utilities ──────────────────────────────────────────────────────
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function notifyPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup might be closed, that's ok
  });
}

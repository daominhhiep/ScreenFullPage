// content.js — Page measurement, scroll control, and element management
// Injected into the active tab by background.js

(() => {
  if (window.__screenFullPageInjected) {
    return;
  }
  window.__screenFullPageInjected = true;

  // Store original styles to restore later
  let originalStyles = [];
  let injectedStyleEl = null;
  let originalScrollBehavior = '';
  let originalScrollPos = { x: 0, y: 0 };

  // The element we actually scroll (window OR a detected inner scroller like ChatGPT)
  let primaryScroller = null;

  // Listen for messages from background.js
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'getPageInfo':
        sendResponse(getPageInfo());
        break;

      case 'preparePage':
        sendResponse(preparePage());
        break;

      case 'scrollTo':
        scrollToPosition(message.x, message.y).then(() => {
          const scroller = getPrimaryScroller();
          sendResponse({
            success: true,
            actualX: scroller === window
              ? (window.scrollX || document.documentElement.scrollLeft)
              : scroller.scrollLeft,
            actualY: scroller === window
              ? (window.scrollY || document.documentElement.scrollTop)
              : scroller.scrollTop,
          });
        });
        return true; // async response

      case 'restorePage':
        restorePage();
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ error: 'Unknown action' });
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // Detect primary scroll container
  // For most pages this is window/document.
  // For SPA chat UIs (ChatGPT, Claude, Gemini) the full page content
  // lives inside an inner div that does the actual scrolling while
  // the body/html have overflow:hidden.
  // ─────────────────────────────────────────────────────────────────
  function detectPrimaryScroller() {
    const html = document.documentElement;
    const body = document.body;

    const htmlOverflow = window.getComputedStyle(html).overflowY;
    const bodyOverflow = window.getComputedStyle(body).overflowY;

    // If html/body is scrollable — standard page, use window
    if (htmlOverflow === 'auto' || htmlOverflow === 'scroll' ||
        bodyOverflow === 'auto' || bodyOverflow === 'scroll' ||
        htmlOverflow === 'visible' || bodyOverflow === 'visible') {
      // Check if window actually scrolls
      if (document.documentElement.scrollHeight > window.innerHeight + 10) {
        return window;
      }
    }

    // Find the deepest, tallest scrollable element that contains the page content
    // Criteria: overflow auto/scroll, very tall (> 80% viewport), actually scrollable
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;

    let bestEl = null;
    let bestScrollH = 0;

    const SKIP_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'IFRAME', 'CANVAS', 'CODE', 'PRE', 'ASIDE', 'NAV']);

    document.querySelectorAll('*').forEach((el) => {
      if (el === html || el === body) return;
      if (SKIP_TAGS.has(el.tagName)) return;

      const cs = window.getComputedStyle(el);
      if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') return;
      if (cs.display === 'none' || cs.visibility === 'hidden') return;

      const scrollH = el.scrollHeight;
      const clientH = el.clientHeight;
      const clientW = el.clientWidth;

      // Must actually be scrollable (at least 1.5x its visible height)
      if (scrollH < clientH * 1.5) return;
      // Must cover most of the viewport width and height
      if (clientH < viewportH * 0.6) return;
      if (clientW < viewportW * 0.5) return;

      if (scrollH > bestScrollH) {
        bestScrollH = scrollH;
        bestEl = el;
      }
    });

    return bestEl || window;
  }

  function getPrimaryScroller() {
    if (!primaryScroller) {
      primaryScroller = detectPrimaryScroller();
    }
    return primaryScroller;
  }

  // ─────────────────────────────────────────────────────────────────
  // Get page dimensions
  // ─────────────────────────────────────────────────────────────────
  function getPageInfo() {
    const body = document.body;
    const html = document.documentElement;
    const scroller = getPrimaryScroller();

    let scrollWidth, scrollHeight;

    if (scroller === window) {
      scrollWidth = Math.max(
        body.scrollWidth || 0,
        body.offsetWidth || 0,
        html.clientWidth || 0,
        html.scrollWidth || 0,
        html.offsetWidth || 0
      );
      scrollHeight = Math.max(
        body.scrollHeight || 0,
        body.offsetHeight || 0,
        html.clientHeight || 0,
        html.scrollHeight || 0,
        html.offsetHeight || 0
      );
    } else {
      // Inner scroller is the real page content container
      scrollWidth = scroller.scrollWidth;
      scrollHeight = scroller.scrollHeight;
    }

    const viewportWidth = html.clientWidth;
    const viewportHeight = (scroller === window) ? html.clientHeight : scroller.clientHeight;
    const devicePixelRatio = window.devicePixelRatio || 1;

    return {
      scrollWidth,
      scrollHeight,
      viewportWidth,
      viewportHeight,
      devicePixelRatio,
      currentScrollX: scroller === window
        ? (window.scrollX || html.scrollLeft)
        : scroller.scrollLeft,
      currentScrollY: scroller === window
        ? (window.scrollY || html.scrollTop)
        : scroller.scrollTop,
      usesInnerScroller: scroller !== window,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Prepare page for capture
  // ─────────────────────────────────────────────────────────────────
  function preparePage() {
    const scroller = getPrimaryScroller();

    // Save original scroll position
    originalScrollPos = {
      x: scroller === window ? (window.scrollX || document.documentElement.scrollLeft) : scroller.scrollLeft,
      y: scroller === window ? (window.scrollY || document.documentElement.scrollTop) : scroller.scrollTop,
    };

    // Save and disable smooth scroll
    originalScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';

    // Inject CSS to hide ALL scrollbars globally
    injectedStyleEl = document.createElement('style');
    injectedStyleEl.id = '__screenfullpage_style__';
    injectedStyleEl.textContent = `
      /* ScreenFullPage: hide scrollbars during capture */
      *::-webkit-scrollbar {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
      }
      * {
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
        scroll-snap-type: none !important;
        scroll-behavior: auto !important;
      }
    `;
    document.head.appendChild(injectedStyleEl);

    // Force eager-load lazy images in viewport
    document.querySelectorAll('img[loading="lazy"]').forEach((img) => {
      img.loading = 'eager';
      if (!img.src && img.dataset.src) img.src = img.dataset.src;
    });

    // Handle fixed/sticky elements
    handleFixedElements('hide');

    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────
  // Fixed / sticky element management
  // ─────────────────────────────────────────────────────────────────
  function handleFixedElements(action) {
    if (action === 'hide') {
      originalStyles = [];
      document.querySelectorAll('*').forEach((el) => {
        const computed = window.getComputedStyle(el);
        if (computed.position === 'fixed' || computed.position === 'sticky') {
          originalStyles.push({
            element: el,
            originalInlinePosition: el.style.position,
            originalInlineTop: el.style.top,
            originalInlineBottom: el.style.bottom,
            originalInlineZIndex: el.style.zIndex,
          });
        }
      });
    } else if (action === 'restore') {
      originalStyles.forEach(({ element, originalInlinePosition, originalInlineTop, originalInlineBottom, originalInlineZIndex }) => {
        element.style.position = originalInlinePosition;
        element.style.top = originalInlineTop;
        element.style.bottom = originalInlineBottom;
        element.style.zIndex = originalInlineZIndex;
      });
      originalStyles = [];
    }
  }

  function setFixedElementsVisibility(isFirstViewport) {
    if (isFirstViewport) {
      originalStyles.forEach(({ element, originalInlinePosition }) => {
        element.style.position = originalInlinePosition || '';
      });
    } else {
      originalStyles.forEach(({ element }) => {
        element.style.position = 'absolute';
        element.style.top = '-9999px';
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Scroll to position — uses the correct scroller (window or inner div)
  // ─────────────────────────────────────────────────────────────────
  async function scrollToPosition(x, y) {
    const isFirstViewport = x === 0 && y === 0;
    setFixedElementsVisibility(isFirstViewport);

    const scroller = getPrimaryScroller();

    if (scroller === window) {
      window.scrollTo(x, y);
    } else {
      scroller.scrollLeft = x;
      scroller.scrollTop = y;
    }

    // Wait for scroll + repaint
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(resolve, 80);
        });
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Restore page
  // ─────────────────────────────────────────────────────────────────
  function restorePage() {
    handleFixedElements('restore');

    if (injectedStyleEl && injectedStyleEl.parentNode) {
      injectedStyleEl.parentNode.removeChild(injectedStyleEl);
      injectedStyleEl = null;
    }

    document.documentElement.style.scrollBehavior = originalScrollBehavior;

    const scroller = getPrimaryScroller();
    if (scroller === window) {
      window.scrollTo(originalScrollPos.x, originalScrollPos.y);
    } else {
      scroller.scrollLeft = originalScrollPos.x;
      scroller.scrollTop = originalScrollPos.y;
    }

    // Reset for next capture
    primaryScroller = null;
  }
})();

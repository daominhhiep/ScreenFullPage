// offscreen.js — Canvas stitching logic
// Receives captured tiles and assembles them into a single image

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'stitchTiles' && message.target === 'offscreen') {
    stitchTiles(message);
  }
});

/**
 * Stitch captured tiles into a single full-page image
 */
async function stitchTiles({
  tiles,
  pageWidth,
  pageHeight,
  viewportWidth,
  viewportHeight,
  devicePixelRatio,
  totalRows,
  totalCols,
  pageUrl,
  pageTitle,
}) {
  try {
    const dpr = devicePixelRatio || 1;

    // Create canvas at full resolution
    const canvasWidth = pageWidth * dpr;
    const canvasHeight = pageHeight * dpr;

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const ctx = canvas.getContext('2d');

    // Load and draw each tile
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];

      try {
        const img = await loadImage(tile.dataUrl);

        // Calculate destination position on canvas
        const destX = tile.x * dpr;
        const destY = tile.y * dpr;

        // Calculate how much of this tile to draw
        // For edge tiles (last row/column), we may need to crop
        let srcWidth = img.width;
        let srcHeight = img.height;
        let drawWidth = viewportWidth * dpr;
        let drawHeight = viewportHeight * dpr;

        // For the last column, only draw the remaining width
        if (tile.col === totalCols - 1) {
          const remainingWidth = (pageWidth - tile.x) * dpr;
          if (remainingWidth < drawWidth) {
            // Crop from the right side of the captured image
            const ratio = remainingWidth / drawWidth;
            srcWidth = Math.round(img.width * ratio);
            drawWidth = remainingWidth;
          }
        }

        // For the last row, only draw the remaining height
        if (tile.row === totalRows - 1) {
          const remainingHeight = (pageHeight - tile.y) * dpr;
          if (remainingHeight < drawHeight) {
            const ratio = remainingHeight / drawHeight;
            srcHeight = Math.round(img.height * ratio);
            drawHeight = remainingHeight;
          }
        }

        ctx.drawImage(
          img,
          0, 0, srcWidth, srcHeight, // source rect
          destX, destY, drawWidth, drawHeight // destination rect
        );
      } catch (tileError) {
        console.error(`Failed to draw tile [${tile.row},${tile.col}]:`, tileError);
        // Continue with other tiles
      }
    }

    // Export canvas to data URL
    const imageDataUrl = canvas.toDataURL('image/png');

    // Send result back to background.js
    chrome.runtime.sendMessage({
      action: 'stitchComplete',
      imageDataUrl,
      pageUrl,
      pageTitle,
    });

  } catch (error) {
    console.error('Stitching failed:', error);
    chrome.runtime.sendMessage({
      action: 'stitchComplete',
      imageDataUrl: null,
      error: error.message,
    });
  }
}

/**
 * Load an image from a data URL
 */
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error('Failed to load image tile'));
    img.src = dataUrl;
  });
}

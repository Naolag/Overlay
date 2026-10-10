
const { desktopCapturer, screen } = require('electron');

const FAST_MAX_WIDTH = 1280;
const FAST_MAX_HEIGHT = 900;
const JPEG_QUALITY = 75;

function logTiming(label, start) {
  console.log(`[SCREEN] ${label}: ${Date.now() - start} ms`);
}

function imageToGeminiPart(nativeImage, label) {
  const start = Date.now();

  if (!nativeImage || nativeImage.isEmpty()) {
    throw new Error(`${label}: captured image is empty.`);
  }

  const originalSize = nativeImage.getSize();

  // Resize only when the image exceeds our fast-mode limits.
  const resizedImage =
    originalSize.width > FAST_MAX_WIDTH ||
    originalSize.height > FAST_MAX_HEIGHT
      ? nativeImage.resize({
          width: FAST_MAX_WIDTH,
          height: FAST_MAX_HEIGHT,
          quality: 'good',
        })
      : nativeImage;

  const jpegBuffer = resizedImage.toJPEG(JPEG_QUALITY);
  const base64 = jpegBuffer.toString('base64');

  logTiming(`${label} resize + JPEG + base64`, start);

  console.log(
    `[SCREEN] Image: ${originalSize.width}x${originalSize.height}, ` +
    `${(jpegBuffer.length / 1024).toFixed(0)} KB JPEG`
  );

  return {
    inline_data: {
      mime_type: 'image/jpeg',
      data: base64,
    },
  };
}

// Existing whole-monitor capture retained for fallback/testing.
async function captureScreenshotPart() {
  const start = Date.now();
  const display = screen.getPrimaryDisplay();

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: FAST_MAX_WIDTH,
      height: FAST_MAX_HEIGHT,
    },
  });

  if (!sources.length) {
    throw new Error('No screen source available to capture.');
  }

  const source =
    sources.find((s) => String(s.display_id) === String(display.id)) ||
    sources[0];

  logTiming('Whole-screen source capture', start);

  return imageToGeminiPart(source.thumbnail, 'Whole screen');
}

// Captures a specified window source.
// The caller must identify the correct active application window.
async function captureWindowSourcePart(sourceId) {
  if (!sourceId) {
    throw new Error('A window source ID is required.');
  }

  const start = Date.now();

  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: {
      width: FAST_MAX_WIDTH,
      height: FAST_MAX_HEIGHT,
    },
  });

  const source = sources.find((item) => item.id === sourceId);

  if (!source) {
    throw new Error(
      'The selected window is no longer available. Please try again.'
    );
  }

  console.log(`[SCREEN] Selected window: ${source.name}`);
  logTiming('Window source capture', start);

  return imageToGeminiPart(source.thumbnail, 'Active window');
}

module.exports = {
  captureScreenshotPart,
  captureWindowSourcePart,
};


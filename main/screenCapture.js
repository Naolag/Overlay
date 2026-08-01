const { desktopCapturer, screen } = require('electron');

// ---------------------------------------------------------------------------
// Captures the primary screen and returns it as a Gemini "part" object ready
// to include in a query. Uses the same desktopCapturer mechanism as the
// self-test loop, so it naturally excludes the overlay itself (consistent
// with WDA_EXCLUDEFROMCAPTURE) — you're capturing everything ELSE on screen,
// same as any other capture tool would see.
//
// PRIVACY NOTE: this sends raw, unsanitized screen pixels to Gemini. There
// is no redaction step yet (that's the planned sanitization engine, not
// built). Only call this on deliberate user action — never automatically.
// ---------------------------------------------------------------------------

async function captureScreenshotPart() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.size;
  const scaleFactor = display.scaleFactor || 1;

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(width * scaleFactor),
      height: Math.round(height * scaleFactor),
    },
  });

  if (!sources.length) {
    throw new Error('No screen source available to capture.');
  }

  const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];

  if (source.thumbnail.isEmpty()) {
    throw new Error('Screen capture returned an empty image.');
  }

  const pngBuffer = source.thumbnail.toPNG();
  const base64 = pngBuffer.toString('base64');

  return { inline_data: { mime_type: 'image/png', data: base64 } };
}

module.exports = { captureScreenshotPart };

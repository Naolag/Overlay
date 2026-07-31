const { desktopCapturer, screen } = require('electron');

// ---------------------------------------------------------------------------
// Continuous self-verification: if WDA_EXCLUDEFROMCAPTURE ever fails silently
// (sleep/wake reset, topology change, an app using a capture path that
// doesn't respect the flag), this is what catches it and hides the overlay
// before a human would notice.
//
// APPROACH NOTE: the "obvious" way to self-check would be calling the same
// Windows.Graphics.Capture API that conferencing tools use — but that's a
// WinRT API, not a plain DLL function, and wiring WinRT/COM interop through
// koffi would be a much larger and more fragile undertaking than the HWND
// pointer issue we already fought through on Day 1. Electron ships its own
// screen-capture API (desktopCapturer) specifically for building features
// like this — no FFI involved at all — so that's what this uses instead.
//
// BIGGEST OPEN QUESTION, flagged honestly: this only works if Electron's
// desktopCapturer uses a capture path that itself respects
// WDA_EXCLUDEFROMCAPTURE (which, based on Day 3 testing against Game Bar/
// Zoom/Meet, is likely — those all worked once the FFI bug was fixed). If
// desktopCapturer instead uses a path that does NOT respect the flag, this
// loop will see the watermark constantly and trip immediately every time,
// which would actually be a very clear, unambiguous signal to watch for on
// first run. Run with SELFTEST_DEBUG=1 to see every check logged.
// ---------------------------------------------------------------------------

const WATERMARK_SIZE_PX = 12;
// MUST match the top/left values on #watermark in renderer/styles.css exactly.
const WATERMARK_OFFSET = { x: 3, y: 3 };
const CHECK_INTERVAL_MS = 2000;
const COLOR_TOLERANCE = 12; // per-channel, absorbs minor capture/compression variance

function randomWatermarkColor() {
  return {
    r: Math.floor(Math.random() * 256),
    g: Math.floor(Math.random() * 256),
    b: Math.floor(Math.random() * 256),
  };
}

class CaptureSelfTest {
  constructor({ getOverlayWindow, onExposureDetected }) {
    this.getOverlayWindow = getOverlayWindow;
    this.onExposureDetected = onExposureDetected;
    this.watermarkColor = randomWatermarkColor();
    this.intervalHandle = null;
    this.isChecking = false;
    this.tripped = false;
  }

  getWatermarkColor() {
    return this.watermarkColor;
  }

  start() {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => this.runCheck(), CHECK_INTERVAL_MS);
    console.log('[captureSelfTest] loop started, interval:', CHECK_INTERVAL_MS, 'ms');
  }

  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async runCheck() {
    if (this.isChecking || this.tripped) return; // never overlap checks; stay stopped after a trip
    const win = this.getOverlayWindow();
    if (!win || win.isDestroyed() || !win.isVisible()) return; // nothing on screen to leak

    this.isChecking = true;
    try {
      const bounds = win.getContentBounds(); // actual rendered content area, not outer window frame
      const display = screen.getDisplayMatching(bounds);
      const scaleFactor = display.scaleFactor || 1;

      // Requesting a thumbnail at the display's full physical resolution
      // keeps the coordinate math simple (1:1 with scaled bounds) at the
      // cost of some CPU per check. If this causes noticeable lag during
      // calls, the fix is to request a smaller thumbnailSize and scale the
      // coordinate math down proportionally — not done here to keep this
      // first version simple and easier to debug.
      const captureWidth = Math.round(display.size.width * scaleFactor);
      const captureHeight = Math.round(display.size.height * scaleFactor);

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: captureWidth, height: captureHeight },
      });

      const source =
        sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];

      if (!source || source.thumbnail.isEmpty()) {
        console.warn('[captureSelfTest] no screen source available to self-check against');
        return;
      }

      const bitmap = source.thumbnail.toBitmap(); // BGRA byte order
      const imgSize = source.thumbnail.getSize();

      // FIXED: compute scale from the image Chromium actually returned,
      // not from display.scaleFactor alone. desktopCapturer is known to
      // sometimes resize/cap thumbnails internally regardless of the
      // requested thumbnailSize — trusting the assumed scale factor in
      // that case silently scans the wrong pixels every time, which
      // would explain a deliberate-exposure test still reporting
      // match:false. This computes the real effective scale instead.
      const effScaleX = imgSize.width / display.size.width;
      const effScaleY = imgSize.height / display.size.height;

      if (process.env.SELFTEST_DEBUG === '1' && (Math.abs(effScaleX - scaleFactor) > 0.01)) {
        console.warn(
          '[captureSelfTest] requested vs actual capture scale mismatch — this was likely the bug:',
          { requestedScaleFactor: scaleFactor, actualScaleX: effScaleX, actualScaleY: effScaleY, imgSize }
        );
      }

      // FIXED: stop trusting one exact calculated pixel. Frameless,
      // resizable windows on Windows commonly have a few pixels of
      // invisible resize-border padding that getBounds() includes but
      // isn't actually part of the visible rendered content — so a single
      // calculated point can land just off the watermark. Search a
      // generous area around the calculated point instead.
      const relX = (bounds.x - display.bounds.x) * effScaleX;
      const relY = (bounds.y - display.bounds.y) * effScaleY;
      const SEARCH_MARGIN_PX = 30; // logical px, generous on purpose
      const searchStartX = Math.max(0, Math.round(relX - 6 * effScaleX));
      const searchEndX = Math.min(imgSize.width - 1, Math.round(relX + SEARCH_MARGIN_PX * effScaleX));
      const searchStartY = Math.max(0, Math.round(relY - 6 * effScaleY));
      const searchEndY = Math.min(imgSize.height - 1, Math.round(relY + SEARCH_MARGIN_PX * effScaleY));

      let match = false;
      let matchPoint = null;
      let samplePixel = null; // for debug logging — the original calculated point

      for (let py = searchStartY; py <= searchEndY && !match; py++) {
        for (let px = searchStartX; px <= searchEndX; px++) {
          const idx = (py * imgSize.width + px) * 4;
          const b = bitmap[idx];
          const g = bitmap[idx + 1];
          const r = bitmap[idx + 2];

          if (samplePixel === null && px === Math.round(relX + WATERMARK_OFFSET.x * effScaleX) && py === Math.round(relY + WATERMARK_OFFSET.y * effScaleY)) {
            samplePixel = { r, g, b };
          }

          if (
            Math.abs(r - this.watermarkColor.r) <= COLOR_TOLERANCE &&
            Math.abs(g - this.watermarkColor.g) <= COLOR_TOLERANCE &&
            Math.abs(b - this.watermarkColor.b) <= COLOR_TOLERANCE
          ) {
            match = true;
            matchPoint = { px, py };
            break;
          }
        }
      }

      if (process.env.SELFTEST_DEBUG === '1') {
        console.log('[captureSelfTest]', {
          searchRegion: { x: [searchStartX, searchEndX], y: [searchStartY, searchEndY] },
          originalCalculatedPixel: samplePixel,
          expected: this.watermarkColor,
          match,
          matchPoint,
        });
      }

      if (match) {
        this.trip();
      }
    } catch (err) {
      console.error('[captureSelfTest] check failed:', err);
    } finally {
      this.isChecking = false;
    }
  }

  trip() {
    if (this.tripped) return;
    this.tripped = true;
    this.stop();
    const timestamp = new Date().toISOString();
    console.error('[captureSelfTest] EXPOSURE DETECTED at', timestamp, '— hiding and clearing overlay now');
    this.onExposureDetected({ timestamp });
  }

  /** Call once the person has investigated and wants to resume normal operation. */
  reset() {
    this.tripped = false;
    this.watermarkColor = randomWatermarkColor(); // fresh watermark for the new session
    this.start();
  }
}

module.exports = { CaptureSelfTest, WATERMARK_OFFSET, WATERMARK_SIZE_PX };

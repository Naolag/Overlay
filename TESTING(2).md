# Testing Guide — How to Actually Run These Checks

Everything here uses tools already on your Windows machine. No new installs needed
except where noted. Organized by "can test now" vs "needs later-day code."

---

## Tool you'll use for almost everything: Xbox Game Bar recorder

Windows has a built-in screen recorder — this is your primary test instrument.

1. Press **Win+G** to open Game Bar
2. Click the record button (or press **Win+Alt+R**) to start recording
3. Do whatever you're testing (see below)
4. Press **Win+Alt+R** again to stop
5. The recording saves to `Videos\Captures\` — open it and **actually watch it**,
   don't just trust that the process ran

This uses the same Windows.Graphics.Capture API that most modern conferencing
tools use, so it's a genuinely representative test, not just a proxy.

---

## Tests you can run right now (Day 2 code)

### 1. Basic exclusion check
1. `npm start`, confirm status reads "✓ Excluded from capture"
2. Start a Game Bar recording (Win+Alt+R)
3. Wait 5 seconds, stop recording
4. Open the video — overlay should be **completely absent**, not faded, not
   flickering, not there for one frame. Gone.

**If it appears at all** — even briefly — treat that as a failure, not
a "mostly works." Go back to `main/native/displayAffinity.js` and the
README troubleshooting section.

### 1b. Screenshot tools — UPDATE: likely was the FFI bug, not a platform gap
**Originally found during Day 2 testing** (Snipping Tool/PrtScn captured the
overlay while Game Bar didn't) **— re-tested after the uint64 FFI fix and now
passes.** Working theory: the earlier `koffi.address()` pointer-construction
bug meant exclusion wasn't reliably applying at all, so it looked like a
platform-specific gap when it was actually just broken. Once the FFI call
was fixed, Microsoft's claim that `WDA_EXCLUDEFROMCAPTURE` excludes at the
compositor level (covering GDI/PrintWindow-style capture too, not just the
modern Windows.Graphics.Capture pipeline) appears to hold.

**Don't fully retire this test yet** — a single clean pass doesn't rule out
an intermittent issue. Keep it in the regular 3x-across-3-days rotation
below until it's proven consistently reliable.

- [x] PrtScn — re-tested, passing
- [x] Snipping Tool (both modes) — re-tested, passing
- [ ] Repeat both 2 more times on different days before fully trusting this


1. Launch the app, confirm ✓ status
2. Press **Win+L** to lock your machine
3. Wait 10 seconds, unlock
4. Check the status line again **without restarting the app**
5. Repeat the Game Bar recording test from #1

Some display-affinity implementations reset after a lock/unlock cycle — this
is the test that catches it. If the status line still shows ✓ but the
recording shows the overlay anyway, that means our status check itself is
unreliable, which is a bigger problem — flag it to me immediately if that
happens.

### 3. Multi-monitor topology change
1. With the app running and excluded, press **Win+P**, cycle through
   "PC screen only" → "Extend" → back to your normal mode
   (or physically plug/unplug a second monitor if you have one)
2. Re-check status, then re-run the Game Bar recording test

### 4. Crash-and-restart check
1. Open Task Manager (**Ctrl+Shift+Esc**)
2. Find the app process (likely listed as "Electron" or the app name),
   **End Task**
3. Relaunch with `npm start`
4. Confirm it re-applies exclusion fresh — status should go from
   "checking" to ✓, not just default to ✓ immediately

### 5. Clipboard bleed check
1. Ask the overlay a question that returns something you wouldn't want
   visible (e.g. a fake "internal hostname" for testing)
2. Copy the response text (select it, Ctrl+C)
3. Press **Win+V** to open Windows Clipboard History
4. See if it's sitting there — if Clipboard History is enabled on your
   machine, anything you copy from the overlay persists in a system-level
   history that's visible outside the overlay entirely
5. If it shows up: either disable Clipboard History (Settings → System →
   Clipboard) or make a habit of clearing it after sensitive copies —
   worth deciding which before Day 7 when the audit log adds more
   copy-able content

---

## Tests that need real conferencing tools (Day 3)

Same Game Bar recording method, but the recording target changes:

- **Zoom native client**: start a Zoom meeting (can be a solo test meeting),
  share your screen, have Game Bar record *your own screen* simultaneously,
  or — better — use a second device to join the Zoom call and record what
  *that device sees* during the share. That second-device recording is the
  real test, since it's what an actual viewer would see.
- **Teams / Google Meet (browser)**: same approach — second device joins
  and records what it receives.
- **OBS**: open OBS, add a "Display Capture" or "Window Capture" source
  for your screen, click record, check the output file.

Use a second phone or laptop to record the call from the *viewer's* side —
this is more reliable than trying to record your own screen while also
being the thing being tested.

---

## Tests that need RDP (if relevant to your on-call workflow)

If you ever RDP into jump boxes or bastion hosts during incidents:

1. From a **second device**, RDP into the machine running the overlay
2. With the overlay visible and excluded locally, check whether it appears
   in the RDP viewer's window
3. This is a genuinely different code path than local screen capture — RDP
   has reports of behaving inconsistently with display-affinity flags, so
   don't assume the Day 1-3 tests cover this. Test it explicitly.

---

## Tests you can't run yet (need Day 5+ code)

These require the self-test loop, which isn't built yet — noting them here
so they don't get forgotten between now and Day 5/8:

- **Self-test failure mode**: deliberately break `excludeFromCapture()`
  (e.g. temporarily hardcode it to return `false`) and confirm the
  self-test loop catches it and hides the overlay — not just that the
  status line changes color
- **Detection latency**: start a Game Bar recording, trigger a simulated
  exposure mid-recording, then scrub the video frame-by-frame (drag the
  video player's seek bar slowly) and count how many frames show the
  overlay before it disappears — multiply by the video's frame time to
  get an actual millisecond number

---

## Tests you can't self-administer — ask instead

- **Corporate EDR/DLP software**: open Task Manager → Details tab, or
  Services (Win+R, type `services.msc`), and look for security-agent
  process names (CrowdStrike, SentinelOne, Forcepoint, Netskope, Microsoft
  Purview, Symantec are common ones). If you find one, the honest move is
  to **ask your IT/security team directly** whether it does periodic
  desktop screenshotting and by what mechanism — this isn't something you
  can reliably test yourself, since these tools are specifically designed
  to be hard to detect and bypass from the inside.

---

## Day 5 — Calibrating the self-test loop

The watermark-detection math has to convert the overlay window's logical
position into physical pixel coordinates on your actual display, accounting
for Windows DPI scaling (100%/125%/150% etc). This is the part most likely
to need tuning — here's how to check it.

1. Run with debug logging on:
   ```
   set SELFTEST_DEBUG=1
   npm start
   ```
   (On PowerShell: `$env:SELFTEST_DEBUG=1; npm start`)

2. You'll see a log line every 2 seconds like:
   ```
   [captureSelfTest] { px: 4, py: 4, captured: { r: 12, g: 8, b: 15 }, expected: { r: 201, g: 44, b: 99 }, match: false }
   ```
   `match: false` every cycle is the expected, healthy state — it means the
   self-capture genuinely can't see the watermark, consistent with exclusion
   working.

3. **If you instead see a warning about coordinates falling outside the
   captured image**, or `match` flips to `true` immediately even though
   Day 3's tests all passed, that's a DPI-scaling calibration issue, not a
   real exposure. Check Settings → System → Display → Scale, and let me
   know your scale percentage plus the logged `px`/`py`/`imgSize` values —
   that's enough to fix the math.

4. **To deliberately test that a real trip works**: temporarily change
   `WATERMARK_OFFSET` in `main/captureSelfTest.js` to a wildly wrong value
   (e.g. `{ x: -9999, y: -9999 }`) — this simulates miscalibration, not a
   real exposure, but confirms the warning path fires. To test the actual
   trip-and-clear behavior, temporarily hardcode `excludeFromCapture()` in
   `main/native/displayAffinity.js` to return `false` after a successful
   call, confirm the dialog fires as expected (Day 2 behavior), then instead
   try commenting out the dialog `return` temporarily to let the window show
   unprotected — WATCH FIRST WHETHER THE SELF-TEST LOOP CATCHES AND HIDES
   IT WITHIN ONE CYCLE. Revert this test change immediately after.


A test passing once is not the same as the mechanism being reliable.
For the Critical-tier tests (basic exclusion, sleep/wake, multi-monitor),
run each **three times on three different days** before trusting it on a
real call — some of these failure modes are intermittent by nature (they
depend on OS state, driver versions, timing), and a single clean run can
hide a real problem.

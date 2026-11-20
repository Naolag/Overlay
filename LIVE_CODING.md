# Live coding mode

Live coding is an isolated workflow started with `Ctrl+I` on Windows. It does not reuse the interview-answer prompt, shared chat history, job-session context, or screenshot-answer handlers. Its context consists of the current challenge instructions, code, screenshots, and live-coding-specific rules.

## Capture and solve flow

1. The existing overlay BrowserWindow is temporarily maximized for the solution view, so long code is readable and scrollable. It is the same HWND and keeps the existing capture-exclusion behavior; no second window is created. Closing the live-coding panel or ending the session restores the saved window bounds.
2. The accessibility reader uses read-only Windows UI Automation text/value patterns. It does not click, focus, scroll, type, select text, or use the clipboard.
3. `Ctrl+I` starts screenshot capture by default. Each image is the full active interview window, including both the left instruction pane and right code editor. Scroll either pane independently; capture overlapping views so the sequence covers all instruction sections and the whole source.
4. Screenshot slots receive stable IDs (`S01`–`S20`) and revisions (`r1`, `r2`, ...). After Gemini requests a clearer area, `Ctrl+I` retakes the first requested screenshot ID automatically. Without a pending request, it adds a new screenshot. A retake replaces that slot in the active set; the prior image revision remains in the app's temporary directory until the session ends. Each analysis resends the complete active set in capture order, with each image's ID and revision.
5. `Ctrl+Shift+Enter` asks Gemini to perform transcription, code reconstruction, and solution generation from all active screenshots in one request. It returns the best-effort full source with requested changes, even when some evidence is unclear. The result is marked provisional when it includes inferred lines or targeted recapture requests. The next `Ctrl+I` can capture the requested area; reanalysis resends all active screenshots.
6. The viewer colors requested edits blue and inferred lines red. Recapture notes cite screenshot IDs, the solution line range where uncertainty appears, visible editor line numbers only when readable, an anchor, and scrolling instructions. Line ranges and recapture targets are model-provided guidance; review them against the image.
7. The prompt requires the model to derive the required language, function signature or stdin/stdout format, constraints, and multiple-test-case behavior from the instructions. It favors an efficient algorithm that fits those constraints, preserves known source, and changes only what the task requires.
8. Gemini's optional code-execution tool can run Python only. The prompt asks it to run the exact proposed Python solution against representative and boundary inputs when available. The app reports tool outputs and downgrades an execution claim if no tool result was returned. For Java, Rust, C++, JavaScript, or other target languages, it reports static reasoning rather than pretending that a Python translation validated the target code. Passing these tests does not establish that hidden tests pass.
9. Use `Ctrl+Shift+End` or **End session and delete screenshots** to remove all temporary screenshot revisions. Closing the panel leaves the session available; application shutdown also attempts cleanup.

The screenshot result view uses the full expanded overlay for the code and uncertainty report. The shortcut strip shows the active keys. The analysis and end-session buttons remain available as mouse alternatives.

## Limits

Screenshots can still omit or blur source and instructions. Gemini may misread visible text, and a prompt cannot recover information absent from every capture. A provisional complete-looking result is not proof of correctness. The code execution tool cannot execute non-Python target code, and neither model reasoning nor local tests reveal hidden interviewer tests.

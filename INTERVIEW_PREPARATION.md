# Interview Preparation Workflow

This feature is isolated on the `feature/pre-interview-job-preparation` branch.

## Prepare before the interview

1. Start the app with `npm start`.
2. Select **Interview Setup**.
3. Paste the full job description.
4. Optionally add interview focus areas (for example, Python, ML fundamentals, debugging, or communication).
5. Select **Analyze & Save Profile** and wait for preparation to finish.
6. Review the generated profile shown in the panel. It should identify the role priorities, CV-backed evidence, gaps, and answer guidance.

The preparation request uses the local `cv.js` module as the candidate source of truth. That file is ignored by Git and is not added to this branch.

## During the interview

Use **Read Screen** or the existing screen-read hotkey. The screenshot request receives only the saved compact profile, not the original job description or preparation prompt. The profile is loaded from Electron's local `userData` directory and is not committed to the repository.

Use **Clear Profile** when changing to a different job. Prepare a new profile before the next interview.

## Latency design

- Job/CV analysis happens only after clicking **Analyze & Save Profile**.
- No preparation call is made for a screenshot.
- The existing screenshot capture, image payload, Gemini endpoint, retry behavior, and empty-history behavior remain unchanged.
- When a profile exists, the screenshot request adds a compact instruction and profile (target maximum 150 words) to the system instruction. This adds a small amount of request context, so identical latency cannot be guaranteed. Measure on the target Windows machine against the previous build.

## Local verification checklist

- [ ] App starts and existing controls still work.
- [ ] Interview Setup opens and closes.
- [ ] Empty job description is rejected without a Gemini call.
- [ ] A valid job description generates and saves a profile.
- [ ] Restarting the app reloads the saved profile.
- [ ] Read Screen uses the prepared profile.
- [ ] Clear Profile removes the saved profile; Read Screen returns to the original default instruction.
- [ ] Compare at least 10 screenshot-response times with and without a profile under similar network conditions.
- [ ] Confirm the original capture-exclusion self-test still passes.

The app needs to be run on the target Windows machine to verify Electron, Win32 capture exclusion, real Gemini requests, and actual response latency. A repository-only review cannot establish those runtime results.

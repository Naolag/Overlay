// ---------------------------------------------------------------------------
// Manages multiple Gemini API keys with automatic failover. A single free
// API key can be exhausted mid-call (rate limit or daily quota) — this lets
// the app fall back to additional configured keys transparently instead of
// failing the request outright.
//
// Configure via .env as GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc. (up to 10
// supported). Falls back to a single GEMINI_API_KEY for backward
// compatibility if no numbered keys are set.
// ---------------------------------------------------------------------------

const MAX_NUMBERED_KEYS = 10;
const DEFAULT_COOLDOWN_MS = 60 * 1000; // 1 minute — reasonable guess for RPM-style limits;
// a daily-quota exhaustion would actually need much longer, but we don't
// have a reliable way to distinguish the two from the error alone, so this
// errs toward retrying sooner rather than leaving a key idle too long.

class ApiKeyManager {
  constructor() {
    this.keys = this._loadKeys();
    this.currentIndex = 0;
    this.keyState = new Map(this.keys.map((k) => [k, { exhaustedUntil: null, invalid: false }]));

    if (this.keys.length > 0) {
      console.log(`[apiKeyManager] loaded ${this.keys.length} Gemini API key(s)`);
    }
  }

  _loadKeys() {
    const keys = [];
    const looksLikePlaceholder = (val) =>
      !val || val.includes('your_') || val.includes('_here') || val.trim().length < 10;

    for (let i = 1; i <= MAX_NUMBERED_KEYS; i++) {
      const val = process.env[`GEMINI_API_KEY_${i}`];
      if (val && !looksLikePlaceholder(val)) keys.push(val);
    }

    // Backward compatibility: only used if no numbered keys were found, so
    // we don't accidentally double-count a key set both ways.
    if (keys.length === 0) {
      const single = process.env.GEMINI_API_KEY;
      if (single && !looksLikePlaceholder(single)) keys.push(single);
    }

    return keys;
  }

  hasKeys() {
    return this.keys.length > 0;
  }

  count() {
    return this.keys.length;
  }

  /**
   * Returns the next usable key, cycling forward from wherever we are.
   * Skips keys marked permanently invalid or currently cooling down.
   * Returns null if every key is currently unusable.
   */
  getUsableKey() {
    const now = Date.now();
    for (let attempt = 0; attempt < this.keys.length; attempt++) {
      const key = this.keys[this.currentIndex];
      const state = this.keyState.get(key);

      if (!state.invalid && (!state.exhaustedUntil || state.exhaustedUntil <= now)) {
        return key;
      }
      this._advance();
    }
    return null;
  }

  _advance() {
    if (this.keys.length === 0) return;
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
  }

  /** Call on a 429 (rate limited) — cools down, moves on to the next key. */
  markRateLimited(key, cooldownMs = DEFAULT_COOLDOWN_MS) {
    const state = this.keyState.get(key);
    if (state) {
      state.exhaustedUntil = Date.now() + cooldownMs;
      console.warn(`[apiKeyManager] key ...${key.slice(-4)} rate-limited, cooling down ${cooldownMs / 1000}s`);
    }
    this._advance();
  }

  /** Call on a 403 (invalid/no permission) — never retried again this session. */
  markInvalid(key) {
    const state = this.keyState.get(key);
    if (state) {
      state.invalid = true;
      console.error(`[apiKeyManager] key ...${key.slice(-4)} marked invalid — will not be retried this session`);
    }
    this._advance();
  }

  /** No-op on purpose: stays on the successful key rather than rotating
   * every request, so each key's budget is used fully before failing over. */
  markSuccess(_key) {}

  statusSummary() {
    const now = Date.now();
    return this.keys.map((key, i) => {
      const state = this.keyState.get(key);
      let status = 'available';
      if (state.invalid) status = 'invalid';
      else if (state.exhaustedUntil && state.exhaustedUntil > now) status = 'cooling down';
      return { index: i, last4: key.slice(-4), status };
    });
  }
}

module.exports = new ApiKeyManager(); // singleton — one shared pool for the whole app
// ---------------------------------------------------------------------------
// Manages multiple Gemini API keys with automatic failover.
//
// Configure via .env as:
//
// GEMINI_API_KEY_1=...
// GEMINI_API_KEY_2=...
// GEMINI_API_KEY_3=...
//
// Up to 10 numbered keys are supported.
//
// Falls back to GEMINI_API_KEY for backward compatibility if no numbered
// keys are configured.
//
// IMPORTANT:
//
// 401 / 403
//   -> Key is considered invalid for this session.
//
// 429
//   -> Key is rate/quota limited and temporarily cooled down.
//
// 5xx
//   -> NOT considered a bad key.
//      GeminiClient retries transient 5xx errors and may then move to the
//      next key without permanently invalidating this key.
//
// This allows keys from separate Google projects/accounts to provide
// independent failover pools without incorrectly destroying healthy keys
// when Gemini temporarily returns 503.
// ---------------------------------------------------------------------------

const MAX_NUMBERED_KEYS = 10;

const DEFAULT_COOLDOWN_MS =
  60 * 1000;

// ---------------------------------------------------------------------------

class ApiKeyManager {
  constructor() {
    this.keys = this._loadKeys();

    this.currentIndex = 0;

    this.keyState = new Map(
      this.keys.map((key) => [
        key,
        {
          exhaustedUntil: null,
          invalid: false,
        },
      ])
    );

    if (this.keys.length > 0) {
      console.log(
        `[apiKeyManager] loaded ${this.keys.length} Gemini API key(s)`
      );
    }
  }

  // -------------------------------------------------------------------------
  // Load API keys from environment.
  // -------------------------------------------------------------------------

  _loadKeys() {
    const keys = [];

    const looksLikePlaceholder = (
      value
    ) =>
      !value ||
      value.includes('your_') ||
      value.includes('_here') ||
      value.trim().length < 10;

    for (
      let i = 1;
      i <= MAX_NUMBERED_KEYS;
      i++
    ) {
      const value =
        process.env[`GEMINI_API_KEY_${i}`];

      if (
        value &&
        !looksLikePlaceholder(value)
      ) {
        keys.push(value);
      }
    }

    // Backward compatibility.
    //
    // Only use GEMINI_API_KEY if there are no numbered keys, preventing
    // accidental duplication.
    if (keys.length === 0) {
      const single =
        process.env.GEMINI_API_KEY;

      if (
        single &&
        !looksLikePlaceholder(single)
      ) {
        keys.push(single);
      }
    }

    return keys;
  }

  // -------------------------------------------------------------------------

  hasKeys() {
    return this.keys.length > 0;
  }

  // -------------------------------------------------------------------------

  count() {
    return this.keys.length;
  }

  // -------------------------------------------------------------------------
  // Get the next currently usable key.
  //
  // Skips:
  // - permanently invalid keys
  // - keys currently on 429 cooldown
  // -------------------------------------------------------------------------

  getUsableKey() {
    if (this.keys.length === 0) {
      return null;
    }

    const now = Date.now();

    for (
      let attempt = 0;
      attempt < this.keys.length;
      attempt++
    ) {
      const key =
        this.keys[this.currentIndex];

      const state =
        this.keyState.get(key);

      if (
        !state.invalid &&
        (
          !state.exhaustedUntil ||
          state.exhaustedUntil <= now
        )
      ) {
        return key;
      }

      this._advance();
    }

    return null;
  }

  // -------------------------------------------------------------------------

  _advance() {
    if (this.keys.length === 0) {
      return;
    }

    this.currentIndex =
      (
        this.currentIndex + 1
      ) % this.keys.length;
  }

  // -------------------------------------------------------------------------
  // Called when Gemini returns 429.
  //
  // This DOES mean the current key/project has hit a rate/quota limit,
  // so we temporarily cool the key down and move to another key.
  // -------------------------------------------------------------------------

  markRateLimited(
    key,
    cooldownMs = DEFAULT_COOLDOWN_MS
  ) {
    const state =
      this.keyState.get(key);

    if (state) {
      state.exhaustedUntil =
        Date.now() + cooldownMs;

      console.warn(
        `[apiKeyManager] key ...${key.slice(
          -4
        )} rate-limited. ` +
          `Cooling down for ${
            cooldownMs / 1000
          }s.`
      );
    }

    this._advance();
  }

  // -------------------------------------------------------------------------
  // Called when Gemini returns 401/403.
  //
  // These indicate authentication/permission problems, so don't retry this
  // key during the current application session.
  // -------------------------------------------------------------------------

  markInvalid(key) {
    const state =
      this.keyState.get(key);

    if (state) {
      state.invalid = true;

      console.error(
        `[apiKeyManager] key ...${key.slice(
          -4
        )} marked invalid — will not be retried this session`
      );
    }

    this._advance();
  }

  // -------------------------------------------------------------------------
  // Called after a transient 5xx error has exhausted its retries.
  //
  // IMPORTANT:
  // This does NOT mark the key invalid.
  //
  // Gemini may simply be temporarily unavailable for this project/account.
  // We move to another configured key as a failover attempt while keeping
  // the original key healthy.
  // -------------------------------------------------------------------------

  advanceAfterTransientFailure(
    key
  ) {
    const state =
      this.keyState.get(key);

    if (state) {
      console.warn(
        `[apiKeyManager] key ...${key.slice(
          -4
        )} experienced a transient Gemini server failure. ` +
          'Key remains valid; moving to the next key.'
      );
    }

    this._advance();
  }

  // -------------------------------------------------------------------------
  // Successful request.
  //
  // We intentionally stay on the successful key rather than rotating every
  // request. This lets each account/project use its available budget normally.
  // -------------------------------------------------------------------------

  markSuccess(_key) {}

  // -------------------------------------------------------------------------
  // Useful for diagnostics.
  // -------------------------------------------------------------------------

  statusSummary() {
    const now = Date.now();

    return this.keys.map(
      (key, index) => {
        const state =
          this.keyState.get(key);

        let status = 'available';

        if (state.invalid) {
          status = 'invalid';
        } else if (
          state.exhaustedUntil &&
          state.exhaustedUntil > now
        ) {
          status = 'cooling down';
        }

        return {
          index,
          last4: key.slice(-4),
          status,
        };
      }
    );
  }
}

// ---------------------------------------------------------------------------

module.exports =
  new ApiKeyManager();
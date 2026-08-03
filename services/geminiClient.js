// ---------------------------------------------------------------------------
// Thin wrapper around the Gemini API's generateContent REST endpoint.
// Supports multi-turn history and multimodal parts (text, image, audio) so
// the same function serves typed chat, screen-read, and voice queries.
// Rotates across multiple API keys via apiKeyManager if one is rate-limited
// or invalid, retrying automatically before failing the request.
// ---------------------------------------------------------------------------

const apiKeyManager = require('./apiKeyManager');

const ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

class GeminiClientError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'GeminiClientError';
    this.cause = cause;
  }
}

/**
 * Sends a multi-turn, multimodal request to Gemini, automatically rotating
 * across configured API keys if one is rate-limited or invalid.
 * @param {Object} args
 * @param {Array} args.history - prior turns: [{role:'user'|'model', parts:[...]}]
 * @param {Array} args.parts - parts for the NEW user turn
 * @param {string} [args.systemInstruction] - persistent context/persona via
 *   Gemini's system_instruction field
 * @returns {Promise<{text: string, history: Array}>}
 */
async function query({ history = [], parts, systemInstruction }) {
  if (!apiKeyManager.hasKeys()) {
    throw new GeminiClientError(
      'No Gemini API key configured. Copy .env.example to .env and add at least one key from ' +
        'https://aistudio.google.com/apikey'
    );
  }

  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const url = `${ENDPOINT_BASE}/${model}:generateContent`;
  const contents = [...history, { role: 'user', parts }];

  const body = { contents };
  if (systemInstruction) {
    body.system_instruction = { parts: [{ text: systemInstruction }] };
  }

  const maxAttempts = apiKeyManager.count();
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const apiKey = apiKeyManager.getUsableKey();
    if (!apiKey) {
      // Every configured key is currently on cooldown or marked invalid.
      break;
    }

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (networkErr) {
      // Not key-specific — no point rotating, this will fail on every key.
      throw new GeminiClientError('Network error reaching Gemini API — check your connection.', networkErr);
    }

    if (response.ok) {
      apiKeyManager.markSuccess(apiKey);
      const data = await response.json();
      const responseParts = data?.candidates?.[0]?.content?.parts ?? [];
      const text = responseParts.map((p) => p.text || '').join('');

      if (!text) {
        throw new GeminiClientError('Gemini API returned an empty or unexpected response shape.', data);
      }

      const modelTurn = { role: 'model', parts: [{ text }] };
      return { text, history: [...contents, modelTurn] };
    }

    const status = response.status;
    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch (_) {
      /* ignore */
    }

    if (status === 429) {
      apiKeyManager.markRateLimited(apiKey);
      lastError = new GeminiClientError('Rate limited by Gemini free tier.', bodyText);
      continue; // try the next key
    }

    if (status === 401 || status === 403) {
      // 401/403 both indicate an auth/permission problem with THIS key —
      // treated identically, marked invalid so it's never retried again
      // this session.
      apiKeyManager.markInvalid(apiKey);
      lastError = new GeminiClientError(
        `Gemini API rejected this key (HTTP ${status} — invalid or no permission).`,
        bodyText
      );
      continue; // try the next key
    }

    if (status === 400) {
      // Not key-related (bad request shape, unsupported audio/image format,
      // etc.) — rotating keys won't help, fail immediately.
      throw new GeminiClientError(
        'Gemini API rejected the request — check the audio/image format if this was a voice/screen query.',
        bodyText
      );
    }

    // Any OTHER status (5xx, etc.): mark rate-limited as a conservative
    // default so rotation still advances — previously, unrecognized status
    // codes fell through here without calling any mark function at all,
    // meaning the loop retried the SAME key repeatedly instead of actually
    // trying a different one. Always making forward progress here matters
    // more than perfectly classifying every possible status code.
    apiKeyManager.markRateLimited(apiKey, 30 * 1000);
    lastError = new GeminiClientError(`Gemini API returned an error (HTTP ${status}).`, bodyText);
  }

  const keyCount = apiKeyManager.count();
  if (lastError) {
    throw new GeminiClientError(
      keyCount > 1
        ? `All ${keyCount} configured Gemini keys are currently unavailable. Last error: ${lastError.message}`
        : lastError.message,
      lastError
    );
  }

  throw new GeminiClientError('No usable Gemini API key available right now (all on cooldown or invalid).');
}

module.exports = { query, GeminiClientError };
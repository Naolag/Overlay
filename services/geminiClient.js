// ---------------------------------------------------------------------------
// Thin wrapper around the Gemini API's generateContent REST endpoint.
// Supports multi-turn history and multimodal parts (text, image, audio) so
// the same function serves typed chat, screen-read, and voice queries.
//
// Multiple Gemini API keys are supported through apiKeyManager.
//
// IMPORTANT:
// - 401/403 = key/authentication/permission problem -> invalidate that key.
// - 429     = rate/quota limit -> cool down that key and try another.
// - 5xx     = temporary Gemini/server problem -> retry with exponential
//             backoff WITHOUT invalidating the key.
// - Network errors/timeouts are retried, but are NOT treated as bad keys.
// ---------------------------------------------------------------------------

const apiKeyManager = require('./apiKeyManager');

const ENDPOINT_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models';

// ---------------------------------------------------------------------------
// Retry configuration
// ---------------------------------------------------------------------------

const MAX_TRANSIENT_RETRIES = 3;

// 1s -> 2s -> 4s, with jitter.
// Google's troubleshooting guidance recommends exponential backoff for
// transient errors such as 503 and 429.
const INITIAL_BACKOFF_MS = 1000;

// Don't allow one request to hang for several minutes.
const REQUEST_TIMEOUT_MS = 45 * 1000;

// ---------------------------------------------------------------------------
// Small helper for delaying retries.
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Exponential backoff with jitter.
//
// retryNumber:
//   0 -> around 1s
//   1 -> around 2s
//   2 -> around 4s
// ---------------------------------------------------------------------------

function getBackoffDelay(retryNumber) {
  const exponentialDelay =
    INITIAL_BACKOFF_MS * Math.pow(2, retryNumber);

  // Add 0-25% random jitter.
  const jitter = exponentialDelay * 0.25 * Math.random();

  return Math.round(exponentialDelay + jitter);
}

// ---------------------------------------------------------------------------
// Perform one HTTP request with an explicit timeout.
// ---------------------------------------------------------------------------

async function makeRequest(url, body, apiKey) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },

      body: JSON.stringify(body),

      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------

class GeminiClientError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'GeminiClientError';
    this.cause = cause;
  }
}

/**
 * Sends a multi-turn, multimodal request to Gemini, automatically rotating
 * across configured API keys when appropriate.
 *
 * @param {Object} args
 * @param {Array} args.history
 * @param {Array} args.parts
 * @param {string} [args.systemInstruction]
 *
 * @returns {Promise<{text: string, history: Array}>}
 */
async function query({
  history = [],
  parts,
  systemInstruction,
}) {
  if (!apiKeyManager.hasKeys()) {
    throw new GeminiClientError(
      'No Gemini API key configured. Copy .env.example to .env and add at least one key from ' +
        'https://aistudio.google.com/apikey'
    );
  }

  const model =
    process.env.GEMINI_MODEL || 'gemini-flash-latest';

  const url =
    `${ENDPOINT_BASE}/${model}:generateContent`;

  const contents = [
    ...history,
    {
      role: 'user',
      parts,
    },
  ];

  const body = {
    contents,
  };

  if (systemInstruction) {
    body.system_instruction = {
      parts: [
        {
          text: systemInstruction,
        },
      ],
    };
  }

  const maxKeys = apiKeyManager.count();

  let lastError = null;

  // -------------------------------------------------------------------------
  // Try each configured key.
  // -------------------------------------------------------------------------

  for (
    let keyAttempt = 0;
    keyAttempt < maxKeys;
    keyAttempt++
  ) {
    const apiKey = apiKeyManager.getUsableKey();

    if (!apiKey) {
      break;
    }

    // -----------------------------------------------------------------------
    // Retry transient server errors on the SAME key.
    // -----------------------------------------------------------------------

    for (
      let transientRetry = 0;
      transientRetry <= MAX_TRANSIENT_RETRIES;
      transientRetry++
    ) {
      let response;

      try {
        console.log(
          `[GeminiClient] Request using key ...${apiKey.slice(-4)} ` +
            `(attempt ${transientRetry + 1}/${MAX_TRANSIENT_RETRIES + 1})`
        );

        response = await makeRequest(
          url,
          body,
          apiKey
        );
      } catch (networkErr) {
        const causeCode =
          networkErr?.cause?.code;

        const isTimeout =
          networkErr?.name === 'AbortError' ||
          causeCode === 'UND_ERR_HEADERS_TIMEOUT' ||
          causeCode === 'UND_ERR_BODY_TIMEOUT' ||
          causeCode === 'UND_ERR_CONNECT_TIMEOUT';

        console.error(
          '[GeminiClient] Network request failed:',
          {
            name: networkErr?.name,
            message: networkErr?.message,
            cause: networkErr?.cause,
            code: causeCode,
            timeout: isTimeout,
          }
        );

        lastError = new GeminiClientError(
          isTimeout
            ? 'Gemini API request timed out while waiting for a response.'
            : `Network error reaching Gemini API: ${
                networkErr?.message || networkErr
              }`,
          networkErr
        );

        // Network problems are not key-specific.
        // Retry the same request instead of burning through all API keys.
        if (
          transientRetry <
          MAX_TRANSIENT_RETRIES
        ) {
          const delay =
            getBackoffDelay(transientRetry);

          console.warn(
            `[GeminiClient] Network error. Retrying in ${delay}ms...`
          );

          await sleep(delay);
          continue;
        }

        // The network itself appears unhealthy.
        // Trying another key would hit the same network.
        throw lastError;
      }

      // ---------------------------------------------------------------------
      // SUCCESS
      // ---------------------------------------------------------------------

      if (response.ok) {
        apiKeyManager.markSuccess(apiKey);

        let data;

        try {
          data = await response.json();
        } catch (jsonErr) {
          throw new GeminiClientError(
            'Gemini API returned an invalid JSON response.',
            jsonErr
          );
        }

        const responseParts =
          data?.candidates?.[0]?.content?.parts ?? [];

        const text = responseParts
          .map((p) => p.text || '')
          .join('');

        if (!text) {
          throw new GeminiClientError(
            'Gemini API returned an empty or unexpected response shape.',
            data
          );
        }

        const modelTurn = {
          role: 'model',
          parts: [
            {
              text,
            },
          ],
        };

        return {
          text,
          history: [
            ...contents,
            modelTurn,
          ],
        };
      }

      // ---------------------------------------------------------------------
      // Read Gemini's response body.
      // ---------------------------------------------------------------------

      const status = response.status;

      let bodyText = '';

      try {
        bodyText = await response.text();
      } catch (_) {
        // Ignore response-body parsing errors.
      }

      console.error(
        '[GeminiClient] Gemini API response:',
        {
          status,
          statusText: response.statusText,
          body: bodyText,
          model,
          key: `...${apiKey.slice(-4)}`,
        }
      );

      // ---------------------------------------------------------------------
      // 401 / 403
      //
      // These are key/authentication/permission problems.
      // This key should not continue being used during this session.
      // ---------------------------------------------------------------------

      if (
        status === 401 ||
        status === 403
      ) {
        apiKeyManager.markInvalid(apiKey);

        lastError =
          new GeminiClientError(
            `Gemini API rejected this key (HTTP ${status} — invalid or no permission).`,
            bodyText
          );

        // Do NOT retry the same invalid key.
        break;
      }

      // ---------------------------------------------------------------------
      // 429
      //
      // Rate/quota limit.
      // Cool this key down and move to another configured key.
      // ---------------------------------------------------------------------

      if (status === 429) {
        apiKeyManager.markRateLimited(apiKey);

        lastError =
          new GeminiClientError(
            'Gemini API rate/quota limit reached (HTTP 429).',
            bodyText
          );

        // Move to another key.
        break;
      }

      // ---------------------------------------------------------------------
      // 500 / 502 / 503 / 504
      //
      // TRANSIENT SERVER ERROR.
      //
      // Do NOT mark the key invalid.
      // Retry the SAME key with exponential backoff.
      // ---------------------------------------------------------------------

      if (
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504
      ) {
        lastError =
          new GeminiClientError(
            `Gemini API temporarily unavailable (HTTP ${status}).`,
            bodyText
          );

        if (
          transientRetry <
          MAX_TRANSIENT_RETRIES
        ) {
          const delay =
            getBackoffDelay(transientRetry);

          console.warn(
            `[GeminiClient] HTTP ${status}. ` +
              `Retrying same key in ${delay}ms...`
          );

          await sleep(delay);

          continue;
        }

        // We exhausted retries for this key.
        //
        // IMPORTANT:
        // We do NOT mark the key invalid.
        //
        // We simply move on and give another configured account/project
        // a chance.
        console.warn(
          `[GeminiClient] HTTP ${status} persisted after ` +
            `${MAX_TRANSIENT_RETRIES + 1} attempts. ` +
            'Trying another configured Gemini key.'
        );

        apiKeyManager.advanceAfterTransientFailure(
          apiKey
        );

        break;
      }

      // ---------------------------------------------------------------------
      // 408 Request Timeout
      //
      // Treat as transient.
      // ---------------------------------------------------------------------

      if (status === 408) {
        lastError =
          new GeminiClientError(
            'Gemini API request timed out (HTTP 408).',
            bodyText
          );

        if (
          transientRetry <
          MAX_TRANSIENT_RETRIES
        ) {
          const delay =
            getBackoffDelay(transientRetry);

          console.warn(
            `[GeminiClient] HTTP 408. ` +
              `Retrying in ${delay}ms...`
          );

          await sleep(delay);

          continue;
        }

        apiKeyManager.advanceAfterTransientFailure(
          apiKey
        );

        break;
      }

      // ---------------------------------------------------------------------
      // 400
      //
      // Bad request. Retrying with another key won't fix the request.
      // ---------------------------------------------------------------------

      if (status === 400) {
        throw new GeminiClientError(
          'Gemini API rejected the request (HTTP 400). Check the request body, model, or multimodal data.',
          bodyText
        );
      }

      // ---------------------------------------------------------------------
      // Other unexpected status.
      //
      // Don't automatically declare the key invalid.
      // ---------------------------------------------------------------------

      lastError =
        new GeminiClientError(
          `Gemini API returned an unexpected error (HTTP ${status}).`,
          bodyText
        );

      console.error(
        '[GeminiClient] Unexpected HTTP status:',
        status
      );

      // Move on to another key rather than poisoning this one.
      apiKeyManager.advanceAfterTransientFailure(
        apiKey
      );

      break;
    }
  }

  // -------------------------------------------------------------------------
  // All keys / attempts failed.
  // -------------------------------------------------------------------------

  const keyCount =
    apiKeyManager.count();

  if (lastError) {
    console.error(
      '[GeminiClient] Final Gemini error:',
      {
        message: lastError.message,
        cause: lastError.cause,
      }
    );

    throw new GeminiClientError(
      keyCount > 1
        ? `Gemini request failed after trying ${keyCount} configured key(s). Last error: ${lastError.message}`
        : lastError.message,
      lastError
    );
  }

  throw new GeminiClientError(
    'No usable Gemini API key available right now.'
  );
}

module.exports = {
  query,
  GeminiClientError,
};
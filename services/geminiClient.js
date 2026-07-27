// ---------------------------------------------------------------------------
// Thin wrapper around the Gemini API's generateContent REST endpoint.
// Kept isolated from Electron entirely (no ipcMain/BrowserWindow references)
// so it can be tested standalone and is easy to swap if you ever move to a
// different backend (Groq, local Ollama, etc.) later.
// ---------------------------------------------------------------------------

const ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

class GeminiClientError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'GeminiClientError';
    this.cause = cause;
  }
}

/**
 * Sends a single-turn prompt to Gemini Flash and returns the text response.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function query(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';

  if (!apiKey || apiKey === 'your_key_here') {
    throw new GeminiClientError(
      'No Gemini API key configured. Copy .env.example to .env and add your key from https://aistudio.google.com/apikey'
    );
  }

  const url = `${ENDPOINT_BASE}/${model}:generateContent`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
      }),
    });
  } catch (networkErr) {
    throw new GeminiClientError('Network error reaching Gemini API — check your connection.', networkErr);
  }

  if (!response.ok) {
    const status = response.status;
    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch (_) {
      /* ignore */
    }

    if (status === 429) {
      throw new GeminiClientError('Rate limited by Gemini free tier — wait a moment and try again.');
    }
    if (status === 400 || status === 403) {
      throw new GeminiClientError('Gemini API rejected the request — check your API key is valid.', bodyText);
    }
    throw new GeminiClientError(`Gemini API returned an error (HTTP ${status}).`, bodyText);
  }

  const data = await response.json();

  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';

  if (!text) {
    throw new GeminiClientError('Gemini API returned an empty or unexpected response shape.', data);
  }

  return text;
}

module.exports = { query, GeminiClientError };

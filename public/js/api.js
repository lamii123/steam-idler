const DEFAULT_TIMEOUT_MS = 20_000;

export async function api(path, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
  const hasBody = fetchOptions.body !== undefined;
  const method = fetchOptions.method || (hasBody ? 'POST' : 'GET');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(path, {
      ...fetchOptions,
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: fetchOptions.signal || controller.signal,
      headers: {
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(fetchOptions.headers || {}),
      },
    });

    const text = await res.text();
    let body = {};

    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: text.slice(0, 200) };
      }
    }

    if (!res.ok) {
      const error = new Error(body.error || `Request failed (${res.status})`);
      error.status = res.status;
      if (body.code) error.code = body.code;
      throw error;
    }

    return body;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. Check the server and try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

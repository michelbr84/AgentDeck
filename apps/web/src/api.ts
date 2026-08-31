/**
 * Safe fetch wrapper that handles empty/malformed responses gracefully.
 * Returns null when the response body is empty or not valid JSON,
 * instead of throwing a SyntaxError.
 */
export async function safeJson<T = unknown>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Fetch wrapper that checks response status and parses JSON safely.
 * Throws on non-OK status with the server's error message if available.
 */
export async function apiFetch<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await safeJson<{ error?: string; message?: string }>(res);
    const msg = body?.message || body?.error || `HTTP ${res.status}`;
    throw new Error(`API error: ${msg}`);
  }
  const data = await safeJson<T>(res);
  if (data === null) {
    // Server returned 200 but body is empty or malformed
    throw new Error(`API returned an empty or malformed response (HTTP ${res.status})`);
  }
  return data;
}

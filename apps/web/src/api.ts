import { ApiAuthError, AUTH_REQUIRED_EVENT, adoptTokenFromLocation, authHeaders, createTokenStore } from './auth';

/**
 * Bearer token used when the daemon runs with `agentdeck web --token`.
 * Tab-scoped (sessionStorage) and shared by every apiFetch call.
 */
export const tokenStore = createTokenStore();

// One-shot sign-in via `?token=` / `#token=`. This runs when the module is
// evaluated — before React mounts and before any apiFetch call can exist — so
// even the pages' mount loads carry the bearer header and leave only after the
// secret is gone from the address bar (it would otherwise ride along as the
// Referer). A React effect in App is too late: child effects fire first.
if (typeof window !== 'undefined') {
  adoptTokenFromLocation(tokenStore, window.location, window.history);
}

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
 * Sends the stored bearer token (if any) and, on 401, announces
 * `agentdeck:auth-required` so the UI can prompt for the token.
 * Throws on non-OK status with the server's error message if available.
 */
export async function apiFetch<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, { ...init, headers: authHeaders(tokenStore.get(), init?.headers) });
  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
    }
    throw new ApiAuthError('Authentication required: paste the --token secret to continue');
  }
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

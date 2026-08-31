/**
 * Token plumbing for the Web Deck when the daemon runs with
 * `agentdeck web --token <secret>`: the server answers 401 to every /api/*
 * request that lacks `Authorization: Bearer <token>`.
 *
 * Everything in this module is DOM-free (no `window`, no `document`) so it can
 * be unit-tested in vitest's node environment. Browser wiring lives in api.ts
 * and App.tsx.
 */

export const TOKEN_STORAGE_KEY = 'agentdeck.authToken';

/** DOM event name dispatched by apiFetch when the daemon rejects a request with 401. */
export const AUTH_REQUIRED_EVENT = 'agentdeck:auth-required';

const TOKEN_PARAM = 'token';

function readQueryToken(search: string): string | null {
  const query = search.startsWith('?') ? search.slice(1) : search;
  if (!query) return null;
  const token = new URLSearchParams(query).get(TOKEN_PARAM)?.trim() ?? '';
  return token ? token : null;
}

/**
 * A fragment is not a form-encoded query string: `+` is a literal plus, only
 * percent-escapes are decoded (and left as-is when malformed).
 */
function readFragmentToken(hash: string): string | null {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  const match = /(?:^|&)token=([^&]*)/.exec(fragment);
  if (!match) return null;
  let raw = match[1] ?? '';
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // keep the raw value
  }
  const token = raw.trim();
  return token ? token : null;
}

/**
 * Reads a one-shot token from the address bar. `#token=…` is the canonical form
 * (a fragment never reaches the server, the Referer header or access logs) and
 * wins over `?token=…`, which is accepted for convenience. Returns the trimmed
 * token, or null when absent or empty.
 */
export function extractTokenFromLocation(loc: { search: string; hash: string }): string | null {
  return readFragmentToken(loc.hash) ?? readQueryToken(loc.search);
}

function withoutTokenParam(raw: string, prefix: '?' | '#'): string {
  const query = raw.startsWith(prefix) ? raw.slice(1) : raw;
  if (!query) return '';
  const params = new URLSearchParams(query);
  if (!params.has(TOKEN_PARAM)) return raw;
  params.delete(TOKEN_PARAM);
  const rest = params.toString();
  return rest ? `${prefix}${rest}` : '';
}

/**
 * Returns path + search + hash with the `token` param removed from both the
 * query string and the fragment, ready for `history.replaceState`. Everything
 * else (other params, non-token fragments) is preserved.
 */
export function stripTokenFromUrl(loc: { pathname: string; search: string; hash: string }): string {
  return `${loc.pathname}${withoutTokenParam(loc.search, '?')}${withoutTokenParam(loc.hash, '#')}`;
}

/**
 * Merges `init` headers (Headers, array of pairs, or plain object) and adds
 * `Authorization: Bearer <token>` when the token is non-empty.
 */
export function authHeaders(token: string | null | undefined, init?: HeadersInit): Headers {
  const headers = new Headers(init);
  const value = token?.trim();
  // A caller-supplied Authorization wins over the stored token.
  if (value && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${value}`);
  return headers;
}

export interface TokenStore {
  get(): string | null;
  set(token: string): void;
  clear(): void;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | null {
  try {
    // Reading `sessionStorage` itself can throw (privacy settings, sandboxed
    // frames) and it does not exist at all outside the browser.
    return (globalThis as { sessionStorage?: StorageLike }).sessionStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Tab-scoped token store. Backed by `sessionStorage` when available so a page
 * reload keeps the session, with an in-memory fallback when storage is missing
 * (`null`) or throws (private mode, quota, SSR). Never throws.
 */
export function createTokenStore(storage?: StorageLike | null): TokenStore {
  const backend = storage === undefined ? defaultStorage() : storage;
  let memory: string | null = null;

  return {
    get() {
      if (backend) {
        try {
          const stored = backend.getItem(TOKEN_STORAGE_KEY);
          if (stored) return stored;
        } catch {
          // fall back to the in-memory copy
        }
      }
      return memory;
    },
    set(token) {
      const value = token.trim();
      if (!value) {
        this.clear();
        return;
      }
      memory = value;
      if (backend) {
        try {
          backend.setItem(TOKEN_STORAGE_KEY, value);
        } catch {
          // storage unavailable; the in-memory copy still serves this tab
        }
      }
    },
    clear() {
      memory = null;
      if (backend) {
        try {
          backend.removeItem(TOKEN_STORAGE_KEY);
        } catch {
          // nothing to do
        }
      }
    },
  };
}

/**
 * One-shot URL sign-in: moves `?token=` / `#token=` into `store` and scrubs it
 * from the address bar. Returns true when a token was taken from the URL.
 *
 * Must run before the first apiFetch — i.e. at module evaluation, not in a
 * React effect: React runs child effects before the parent's, so a page's
 * mount load would otherwise go out without the bearer header while the
 * secret is still in the document URL (and therefore in the Referer).
 */
export function adoptTokenFromLocation(
  store: TokenStore,
  loc: { pathname: string; search: string; hash: string },
  history: Pick<History, 'replaceState'>,
): boolean {
  const token = extractTokenFromLocation(loc);
  if (!token) return false;
  store.set(token);
  try {
    history.replaceState(null, '', stripTokenFromUrl(loc));
  } catch {
    // The token is stored either way; the address bar just keeps the param.
  }
  return true;
}

/** Thrown by apiFetch when the daemon answers 401 (missing or wrong `--token`). */
export class ApiAuthError extends Error {
  readonly status = 401;

  constructor(message = 'Authentication required: this Web Deck was started with --token') {
    super(message);
    this.name = 'ApiAuthError';
  }
}

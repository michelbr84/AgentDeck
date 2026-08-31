import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_STORAGE_KEY } from '../src/auth';

/**
 * Wiring of the one-shot `?token=` sign-in in api.ts. It has to happen when the
 * module is evaluated — before React mounts, so before any page's mount load can
 * call apiFetch — which is why these tests stub `window` / `sessionStorage` and
 * import the module fresh for every case.
 */

interface Loc {
  pathname: string;
  search: string;
  hash: string;
}

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

async function loadApiAt(location: Loc) {
  const events: string[] = [];
  const storage = fakeStorage();
  const replaceState = vi.fn((_state: unknown, _unused: string, url?: string | null) => {
    events.push(`replaceState ${url}`);
  });
  vi.stubGlobal('sessionStorage', storage);
  vi.stubGlobal('window', { location, history: { replaceState }, dispatchEvent: vi.fn() });
  vi.resetModules();
  const api = await import('../src/api');
  return { api, events, storage, replaceState };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('api.ts bootstrap: one-shot ?token= sign-in', () => {
  it('stores ?token= and scrubs the address bar as soon as the module is evaluated', async () => {
    const { api, storage, replaceState } = await loadApiAt({ pathname: '/', search: '?token=CORRECT-SECRET', hash: '' });

    expect(api.tokenStore.get()).toBe('CORRECT-SECRET');
    expect(storage.getItem(TOKEN_STORAGE_KEY)).toBe('CORRECT-SECRET');
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
  });

  it('accepts #token= and keeps the rest of the URL', async () => {
    const { api, replaceState } = await loadApiAt({ pathname: '/deck', search: '?tab=chat', hash: '#token=frag-secret' });

    expect(api.tokenStore.get()).toBe('frag-secret');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/deck?tab=chat');
  });

  it('the very first apiFetch already carries the bearer header, after the URL was scrubbed', async () => {
    const { api, events } = await loadApiAt({ pathname: '/', search: '?token=CORRECT-SECRET', hash: '' });
    const seen: Array<{ url: string; authorization: string | null }> = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      events.push(`fetch ${url}`);
      seen.push({ url, authorization: new Headers(init?.headers).get('authorization') });
      return new Response('[]', { status: 200 });
    });

    await expect(api.apiFetch('/api/v1/agents')).resolves.toEqual([]);

    expect(seen).toEqual([{ url: '/api/v1/agents', authorization: 'Bearer CORRECT-SECRET' }]);
    // The address bar was clean before the request went out (no token in the Referer).
    expect(events).toEqual(['replaceState /', 'fetch /api/v1/agents']);
  });

  it('leaves the store and the address bar alone when the URL has no token', async () => {
    const { api, replaceState } = await loadApiAt({ pathname: '/', search: '?tab=chat', hash: '#/rooms' });

    expect(api.tokenStore.get()).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('is a no-op outside the browser', async () => {
    vi.resetModules();
    const api = await import('../src/api');

    expect(api.tokenStore.get()).toBeNull();
  });
});

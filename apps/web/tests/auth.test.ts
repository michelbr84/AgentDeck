import { describe, it, expect, vi } from 'vitest';
import {
  ApiAuthError,
  AUTH_REQUIRED_EVENT,
  TOKEN_STORAGE_KEY,
  adoptTokenFromLocation,
  authHeaders,
  createTokenStore,
  extractTokenFromLocation,
  stripTokenFromUrl,
} from '../src/auth';

/**
 * Pure helpers behind the Web Deck's `--token` support. They run in vitest's
 * node environment, so nothing here may touch `window` or `document`.
 */

describe('extractTokenFromLocation', () => {
  it('reads ?token= from the query string', () => {
    expect(extractTokenFromLocation({ search: '?token=abc123', hash: '' })).toBe('abc123');
  });

  it('reads #token= from the fragment', () => {
    expect(extractTokenFromLocation({ search: '', hash: '#token=frag-secret' })).toBe('frag-secret');
  });

  it('prefers the query string over the fragment', () => {
    expect(extractTokenFromLocation({ search: '?token=from-query', hash: '#token=from-hash' })).toBe('from-hash');
  });

  it('returns null when no token is present', () => {
    expect(extractTokenFromLocation({ search: '', hash: '' })).toBeNull();
    expect(extractTokenFromLocation({ search: '?tab=chat', hash: '#/rooms' })).toBeNull();
  });

  it('treats an empty or blank token as missing', () => {
    expect(extractTokenFromLocation({ search: '?token=', hash: '' })).toBeNull();
    expect(extractTokenFromLocation({ search: '?token=%20%20', hash: '' })).toBeNull();
    expect(extractTokenFromLocation({ search: '', hash: '#token=' })).toBeNull();
  });

  it('url-decodes and trims the value', () => {
    expect(extractTokenFromLocation({ search: '?token=a%2Fb%3Dc%20', hash: '' })).toBe('a/b=c');
    expect(extractTokenFromLocation({ search: '?token=+padded+', hash: '' })).toBe('padded');
  });

  it('finds the token among other params', () => {
    expect(extractTokenFromLocation({ search: '?tab=chat&token=xyz&room=1', hash: '' })).toBe('xyz');
  });
});

describe('stripTokenFromUrl', () => {
  it('removes a lone ?token= and leaves a clean path', () => {
    expect(stripTokenFromUrl({ pathname: '/', search: '?token=abc', hash: '' })).toBe('/');
  });

  it('keeps other query params and the hash', () => {
    expect(stripTokenFromUrl({ pathname: '/deck', search: '?tab=chat&token=abc&room=1', hash: '#/rooms' })).toBe(
      '/deck?tab=chat&room=1#/rooms',
    );
  });

  it('removes #token= from the fragment and keeps the query', () => {
    expect(stripTokenFromUrl({ pathname: '/', search: '?tab=chat', hash: '#token=abc' })).toBe('/?tab=chat');
    expect(stripTokenFromUrl({ pathname: '/', search: '', hash: '#token=abc&view=x' })).toBe('/#view=x');
  });

  it('leaves urls without a token untouched', () => {
    expect(stripTokenFromUrl({ pathname: '/deck', search: '?tab=chat', hash: '#/rooms' })).toBe('/deck?tab=chat#/rooms');
    expect(stripTokenFromUrl({ pathname: '/', search: '', hash: '' })).toBe('/');
  });
});

describe('authHeaders', () => {
  it('adds a bearer header when a token is given', () => {
    const headers = authHeaders('secret');
    expect(headers.get('authorization')).toBe('Bearer secret');
  });

  it('adds no header when the token is null, undefined or empty', () => {
    expect(authHeaders(null).has('authorization')).toBe(false);
    expect(authHeaders(undefined).has('authorization')).toBe(false);
    expect(authHeaders('').has('authorization')).toBe(false);
    expect(authHeaders('   ').has('authorization')).toBe(false);
  });

  it('merges a plain object of headers', () => {
    const headers = authHeaders('secret', { 'Content-Type': 'application/json' });
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('authorization')).toBe('Bearer secret');
  });

  it('merges a Headers instance', () => {
    const headers = authHeaders('secret', new Headers({ Accept: 'application/json' }));
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('authorization')).toBe('Bearer secret');
  });

  it('merges an array of pairs', () => {
    const headers = authHeaders('secret', [['X-Trace', '1']]);
    expect(headers.get('x-trace')).toBe('1');
    expect(headers.get('authorization')).toBe('Bearer secret');
  });

  it('keeps existing headers intact when no token is given', () => {
    const headers = authHeaders(null, { 'Content-Type': 'application/json' });
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.has('authorization')).toBe(false);
  });
});

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      data.delete(key);
    }),
  };
}

function throwingStorage() {
  const boom = () => {
    throw new Error('storage disabled');
  };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

describe('createTokenStore', () => {
  it('persists through the given storage under TOKEN_STORAGE_KEY', () => {
    const storage = fakeStorage();
    const store = createTokenStore(storage);

    expect(store.get()).toBeNull();
    store.set('secret');
    expect(storage.data.get(TOKEN_STORAGE_KEY)).toBe('secret');
    expect(store.get()).toBe('secret');

    store.clear();
    expect(storage.data.has(TOKEN_STORAGE_KEY)).toBe(false);
    expect(store.get()).toBeNull();
  });

  it('reads a token that was already in storage (page reload)', () => {
    const storage = fakeStorage();
    storage.data.set(TOKEN_STORAGE_KEY, 'from-reload');
    expect(createTokenStore(storage).get()).toBe('from-reload');
  });

  it('trims the token and treats an empty value as clear()', () => {
    const storage = fakeStorage();
    const store = createTokenStore(storage);
    store.set('  padded  ');
    expect(store.get()).toBe('padded');
    store.set('   ');
    expect(store.get()).toBeNull();
    expect(storage.data.has(TOKEN_STORAGE_KEY)).toBe(false);
  });

  it('falls back to memory when storage is null', () => {
    const store = createTokenStore(null);
    expect(store.get()).toBeNull();
    store.set('mem');
    expect(store.get()).toBe('mem');
    store.clear();
    expect(store.get()).toBeNull();
  });

  it('never throws when storage throws, and still remembers the token in memory', () => {
    const store = createTokenStore(throwingStorage());
    expect(() => store.get()).not.toThrow();
    expect(store.get()).toBeNull();
    expect(() => store.set('resilient')).not.toThrow();
    expect(store.get()).toBe('resilient');
    expect(() => store.clear()).not.toThrow();
    expect(store.get()).toBeNull();
  });

  it('does not throw in an environment without sessionStorage', () => {
    expect(typeof globalThis.sessionStorage).toBe('undefined');
    const store = createTokenStore();
    expect(store.get()).toBeNull();
    store.set('no-dom');
    expect(store.get()).toBe('no-dom');
  });
});

describe('adoptTokenFromLocation', () => {
  it('stores the URL token, scrubs the address bar and reports true', () => {
    const store = createTokenStore(null);
    const replaceState = vi.fn();
    const adopted = adoptTokenFromLocation(
      store,
      { pathname: '/deck', search: '?tab=chat&token=abc', hash: '#/rooms' },
      { replaceState },
    );
    expect(adopted).toBe(true);
    expect(store.get()).toBe('abc');
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/deck?tab=chat#/rooms');
  });

  it('reads #token= as well', () => {
    const store = createTokenStore(null);
    const replaceState = vi.fn();
    expect(adoptTokenFromLocation(store, { pathname: '/', search: '', hash: '#token=frag' }, { replaceState })).toBe(true);
    expect(store.get()).toBe('frag');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
  });

  it('leaves the store and the address bar alone without a token', () => {
    const store = createTokenStore(null);
    store.set('kept');
    const replaceState = vi.fn();
    expect(adoptTokenFromLocation(store, { pathname: '/', search: '?tab=chat', hash: '' }, { replaceState })).toBe(false);
    expect(store.get()).toBe('kept');
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('keeps the token even when replaceState throws', () => {
    const store = createTokenStore(null);
    const replaceState = vi.fn(() => {
      throw new Error('SecurityError');
    });
    expect(() =>
      adoptTokenFromLocation(store, { pathname: '/', search: '?token=abc', hash: '' }, { replaceState }),
    ).not.toThrow();
    expect(store.get()).toBe('abc');
  });
});

describe('ApiAuthError', () => {
  it('is an Error with status 401 and a default message', () => {
    const err = new ApiAuthError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiAuthError);
    expect(err.status).toBe(401);
    expect(err.name).toBe('ApiAuthError');
    expect(err.message).toMatch(/authentication required/i);
  });

  it('accepts a custom message', () => {
    expect(new ApiAuthError('custom').message).toBe('custom');
  });
});

describe('constants', () => {
  it('exposes stable storage key and event name', () => {
    expect(TOKEN_STORAGE_KEY).toBe('agentdeck.authToken');
    expect(AUTH_REQUIRED_EVENT).toBe('agentdeck:auth-required');
  });
});

describe('authHeaders precedence', () => {
  it('keeps an explicit Authorization header supplied by the caller', () => {
    const h = authHeaders('stored-token', { Authorization: 'Bearer explicit' });
    expect(h.get('Authorization')).toBe('Bearer explicit');
  });
});

describe('fragment tokens are read literally', () => {
  it('keeps a plus sign in #token= (a fragment is not form-encoded)', () => {
    expect(extractTokenFromLocation({ search: '', hash: '#token=a+b' })).toBe('a+b');
  });
  it('percent-decodes #token= and tolerates a malformed escape', () => {
    expect(extractTokenFromLocation({ search: '', hash: '#token=a%2Bb' })).toBe('a+b');
    expect(extractTokenFromLocation({ search: '', hash: '#token=100%' })).toBe('100%');
  });
  it('finds #token= among other fragment params', () => {
    expect(extractTokenFromLocation({ search: '', hash: '#/rooms&token=xyz&x=1' })).toBe('xyz');
  });
});

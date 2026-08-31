import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SecretStore, redactSecrets } from '../src/index.js';

describe('SecretStore', () => {
  let tmp: string;
  let store: SecretStore;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-secrets-'));
    store = new SecretStore({ secretsDir: path.join(tmp, 'secrets') });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('round-trips a credential and returns a reference, not the value', async () => {
    const ref = await store.set('openrouter', 'sk-or-v1-abcdefghijklmnopqrstuvwxyz');
    expect(ref).toBe('file:openrouter');
    expect(ref).not.toContain('sk-or');
    expect(await store.get('openrouter')).toBe('sk-or-v1-abcdefghijklmnopqrstuvwxyz');
    expect(await store.resolve(ref)).toBe('sk-or-v1-abcdefghijklmnopqrstuvwxyz');
  });

  it('writes the key file 0600 and the directory 0700', async () => {
    await store.set('openrouter', 'secret-value');
    const fileMode = (await fs.stat(path.join(tmp, 'secrets', 'openrouter.key'))).mode & 0o777;
    const dirMode = (await fs.stat(path.join(tmp, 'secrets'))).mode & 0o777;
    expect(fileMode).toBe(0o600);
    expect(dirMode).toBe(0o700);
  });

  it('tightens a pre-existing world-readable secrets directory', async () => {
    // `mkdir -p` leaves an existing 0755 directory alone, so the chmod has to
    // be unconditional or a permissive directory survives forever.
    await fs.mkdir(path.join(tmp, 'secrets'), { recursive: true, mode: 0o755 });
    await fs.chmod(path.join(tmp, 'secrets'), 0o755);
    await store.set('openrouter', 'secret-value');
    expect((await fs.stat(path.join(tmp, 'secrets'))).mode & 0o777).toBe(0o700);
  });

  it('reports presence without disclosing values', async () => {
    await store.set('openrouter', 'sk-or-v1-zzzzzzzzzzzzzzzzzzzzzzzz');
    const status = await store.status();
    expect(status).toEqual({ openrouter: true });
    expect(JSON.stringify(status)).not.toContain('sk-or');
  });

  it('survives redactSecrets so the UI can still read presence', async () => {
    await store.set('openrouter', 'sk-or-v1-zzzzzzzzzzzzzzzzzzzzzzzz');
    const payload = { credentialRef: 'file:openrouter', credentialPresent: true };
    expect(redactSecrets(payload)).toEqual(payload);
  });

  it('returns null rather than throwing for a missing credential', async () => {
    expect(await store.get('openrouter')).toBeNull();
    expect(await store.has('openrouter')).toBe(false);
    expect(await store.status()).toEqual({});
  });

  it('rejects an empty credential', async () => {
    await expect(store.set('openrouter', '   ')).rejects.toThrow(/empty credential/);
  });

  it('refuses provider ids that would escape the secrets directory', async () => {
    await expect(store.set('../../etc/passwd', 'x')).rejects.toThrow(/invalid provider id/);
    expect(SecretStore.providerFromRef('file:../../etc/passwd')).toBeNull();
    expect(SecretStore.providerFromRef('env:OPENROUTER_API_KEY')).toBeNull();
  });

  it('deletes a credential idempotently', async () => {
    await store.set('openrouter', 'x-value');
    expect(await store.delete('openrouter')).toBe(true);
    expect(await store.delete('openrouter')).toBe(false);
    expect(await store.has('openrouter')).toBe(false);
  });
});

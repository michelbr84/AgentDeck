import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../src/index.js';

/**
 * Regression guard for the over-broad key patterns.
 *
 * `redactSecrets` runs over EVERY server response and every WebSocket
 * broadcast, so a pattern that is one character too greedy silently deletes
 * product data on the wire. These cases pin both directions.
 */
describe('redactSecrets — key precision', () => {
  it('keeps AgentInstallationState.authentication readable', () => {
    const state = {
      availability: 'available',
      installation: 'installed',
      configuration: 'configured',
      authentication: 'authenticated',
      health: 'healthy',
      version: 'current',
      runtime: 'stopped',
    };
    expect(redactSecrets(state)).toEqual(state);
  });

  it('keeps usage telemetry readable', () => {
    const usage = {
      tokensUsed: {
        input: { source: 'estimated', value: 120 },
        output: { source: 'estimated', value: 340 },
        total: { source: 'estimated', value: 460 },
      },
      totalTokens: 460,
      costUSD: { source: 'estimated', value: 0.0005 },
    };
    expect(redactSecrets(usage)).toEqual(usage);
  });

  it('keeps the credential metadata the UI needs', () => {
    const meta = { credentialRef: 'file:openrouter', credentialPresent: true };
    expect(redactSecrets(meta)).toEqual(meta);
  });

  it('still redacts real credential-bearing keys', () => {
    const redacted = redactSecrets({
      apiKey: 'sk-or-v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      api_key: 'x',
      OPENROUTER_API_KEY: 'x',
      authToken: 'x',
      auth_token: 'x',
      authorization: 'Bearer x',
      accessToken: 'x',
      refresh_token: 'x',
      token: 'x',
      password: 'x',
      passphrase: 'x',
      clientSecret: 'x',
      privateKey: 'x',
    }) as Record<string, string>;

    for (const [key, value] of Object.entries(redacted)) {
      expect(value, `${key} must be redacted`).toBe('[REDACTED_SECRET]');
    }
  });

  it('redacts secret-shaped values even under an innocuous key', () => {
    const out = redactSecrets({ note: 'use sk-or-v1-abcdefghijklmnopqrstuvwxyz to auth' }) as {
      note: string;
    };
    expect(out.note).toContain('[REDACTED_SECRET]');
    expect(out.note).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });

  it('redacts GitHub fine-grained PATs (github_pat_...)', () => {
    const out = redactSecrets({
      note: 'push with github_pat_11AAAAAAA0aaaaaaaaaaaa_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa please',
    }) as { note: string };
    expect(out.note).toContain('[REDACTED_SECRET]');
    expect(out.note).not.toContain('github_pat_11AAAAAAA');
  });

  it('redacts PEM private-key blocks, including labeled variants', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEAfakefakefakefakefakefake',
      'fakefakefakefakefakefakefakefakefakefake',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const out = redactSecrets({ note: `here is my key:\n${pem}\nthanks` }) as { note: string };
    expect(out.note).toContain('[REDACTED_SECRET]');
    expect(out.note).not.toContain('MIIEowIBAA');

    const pkcs8 = '-----BEGIN PRIVATE KEY-----\nMC4CAQAfakefake\n-----END PRIVATE KEY-----';
    const out2 = redactSecrets({ note: pkcs8 }) as { note: string };
    expect(out2.note).toBe('[REDACTED_SECRET]');
  });

  it('keeps status-flavoured keys that merely mention secrets readable', () => {
    const status = {
      secretsConfigured: true,
      secretStoreHealthy: 'ok',
      configured: ['openrouter'],
    };
    expect(redactSecrets(status)).toEqual(status);
  });

  it('still redacts keys that hold secret material', () => {
    const redacted = redactSecrets({
      secret: 'x',
      secrets: ['x'],
      secretKey: 'x',
      secret_key: 'x',
      sharedSecret: 'x',
    }) as Record<string, string>;
    for (const [key, value] of Object.entries(redacted)) {
      expect(value, `${key} must be redacted`).toBe('[REDACTED_SECRET]');
    }
  });
});

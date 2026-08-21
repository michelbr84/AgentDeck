import { describe, it, expect } from 'vitest';
import { redactSecrets, isSafeCliArgument, generateSecureToken } from '../src/index.js';

describe('@agentdeck/security primitives', () => {
  it('should redact sensitive API keys and secrets', () => {
    const raw = {
      apiKey: 'sk-1234567890abcdef1234567890',
      user: 'alice',
      nested: {
        token: 'secret-token',
        notes: 'Call with client',
      },
    };
    const sanitized = redactSecrets(raw);
    expect(sanitized.apiKey).toBe('[REDACTED_SECRET]');
    expect(sanitized.nested.token).toBe('[REDACTED_SECRET]');
    expect(sanitized.user).toBe('alice');
    expect(sanitized.nested.notes).toBe('Call with client');
  });

  it('should validate CLI arguments against dangerous shell chaining metacharacters', () => {
    expect(isSafeCliArgument('hello-world')).toBe(true);
    expect(isSafeCliArgument('my_param=123')).toBe(true);
    expect(isSafeCliArgument('cat file; rm -rf /')).toBe(false);
    expect(isSafeCliArgument('val | grep foo')).toBe(false);
  });

  it('should generate secure tokens of expected length', () => {
    const token = generateSecureToken(16);
    expect(token).toHaveLength(32); // 16 bytes = 32 hex chars
  });
});

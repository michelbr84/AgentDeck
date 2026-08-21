import { describe, it, expect } from 'vitest';
import {
  redactSecrets,
  isSafeCliArgument,
  isSafeOpaqueContentArgument,
  isSafePathArgument,
  generateSecureToken,
} from '../src/index.js';

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

  it('should validate CLI arguments against dangerous shell chaining metacharacters for structural commands', () => {
    expect(isSafeCliArgument('hello-world')).toBe(true);
    expect(isSafeCliArgument('my_param=123')).toBe(true);
    expect(isSafeCliArgument('cat file; rm -rf /')).toBe(false);
    expect(isSafeCliArgument('val | grep foo')).toBe(false);
    expect(isSafeCliArgument('multi\nline')).toBe(false);
  });

  it('should allow rich multiline Markdown, semicolons, and pipes for opaque-user-content in spawn(shell:false)', () => {
    const complexPrompt = `### Global Policy
1. Deliver high quality code.
2. Ensure shell commands like "ls | grep foo; echo bar" are explained.
$VARIABLE substitution and \`backticks\` in markdown blocks:
\`\`\`bash
echo "Hello $USER" > /tmp/output.log
\`\`\`
Portuguese Unicode: "Olá! Como você está hoje?"`;

    expect(isSafeOpaqueContentArgument(complexPrompt)).toBe(true);
    // Disallows NUL bytes
    expect(isSafeOpaqueContentArgument('contains \0 byte')).toBe(false);
    // Respects byte size limit
    expect(isSafeOpaqueContentArgument('too large', 5)).toBe(false);
  });

  it('should validate path arguments safely', () => {
    expect(isSafePathArgument('/home/user/workspace/agentdeck')).toBe(true);
    expect(isSafePathArgument('./relative/path_to-file.ts')).toBe(true);
    expect(isSafePathArgument('/home/user; rm -rf /')).toBe(false);
    expect(isSafePathArgument('/home/user\0/hack')).toBe(false);
  });

  it('should generate secure tokens of expected length', () => {
    const token = generateSecureToken(16);
    expect(token).toHaveLength(32); // 16 bytes = 32 hex chars
  });
});

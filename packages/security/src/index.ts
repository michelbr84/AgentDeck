import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// ==========================================
// 1. FILE & DIRECTORY PERMISSION CONTROLS
// ==========================================
/**
 * Ensures a directory exists with strict permissions (0700).
 */
export async function ensureSecureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });
  try {
    await fs.chmod(dirPath, 0o700);
  } catch {
    // Ignore chmod failures on systems that don't support POSIX modes
  }
}

/**
 * Ensures a sensitive file exists or is created with 0600 permissions.
 */
export async function writeSecureFile(filePath: string, content: string | Buffer): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureSecureDirectory(dir);
  await fs.writeFile(filePath, content, { mode: 0o600, encoding: typeof content === 'string' ? 'utf8' : undefined });
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // Ignore on non-POSIX
  }
}

// ==========================================
// 2. REDACTION & SECRET FILTERING
// ==========================================
const SENSITIVE_KEY_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /token/i,
  /auth/i,
  /password/i,
  /credential/i,
  /private[_-]?key/i,
];

const SECRET_VALUE_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{15,}/g,                  // OpenAI / Anthropic API keys (including sk-ant-...)
  /xox[baprs]-[0-9]{10,}-[a-zA-Z0-9]{24,}/g, // Slack tokens
  /gh[pousr]_[a-zA-Z0-9]{36,}/g,           // GitHub tokens
  /claude-[a-zA-Z0-9_-]{20,}/g,            // Generic Anthropic style tokens
  /ey[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, // JWT strings
];

/**
 * Recursively redacts sensitive keys and values from objects before logging, prompt-inspection, or WebSocket broadcast.
 */
export function redactSecrets<T>(input: T, depth = 0): T {
  if (depth > 10) return '[Max Depth Reached]' as T;
  if (typeof input === 'string') {
    let result: string = input;
    for (const pattern of SECRET_VALUE_PATTERNS) {
      result = result.replace(pattern, '[REDACTED_SECRET]');
    }
    return result as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactSecrets(item, depth + 1)) as T;
  }

  if (input !== null && typeof input === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const isSensitiveKey = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      if (isSensitiveKey) {
        sanitized[key] = '[REDACTED_SECRET]';
      } else {
        sanitized[key] = redactSecrets(value, depth + 1);
      }
    }
    return sanitized as T;
  }

  return input;
}

// ==========================================
// 3. SECURE TOKEN GENERATION
// ==========================================
/**
 * Generates a cryptographically secure random token.
 */
export function generateSecureToken(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString('hex');
}

/**
 * Constant-time string comparison to prevent timing attacks on tokens.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// ==========================================
// 4. SAFE SHELL ARGUMENT VALIDATION
// ==========================================
/**
 * Validates that an argument does not contain dangerous shell command chaining characters.
 */
export function isSafeCliArgument(arg: string): boolean {
  // Disallow shell control metacharacters in strict CLI argument modes
  const dangerousChars = /[;&|`$><\n\r\0]/;
  return !dangerousChars.test(arg);
}

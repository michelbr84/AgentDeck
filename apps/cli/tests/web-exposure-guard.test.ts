import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '..', 'dist', 'index.js');

/**
 * `agentdeck web` must refuse to expose the daemon beyond loopback without a
 * token — via `--lan` or via a non-loopback `--host`. Both are pre-validated
 * before anything listens, so a passing run never leaves a server behind; a
 * regression would hang until the kill below and fail on the exit code.
 */
async function runWeb(args: string[]): Promise<{ code: number | null; stderr: string }> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-web-guard-'));
  try {
    return await new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, 'web', ...args], {
        env: { ...process.env, HOME: home },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ code, stderr });
      });
    });
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

describe('agentdeck web — exposure beyond loopback requires --token', () => {
  it('refuses --lan without --token', async () => {
    const r = await runWeb(['--lan']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/--lan requires --token/);
  });

  it('refuses a non-loopback --host without --token', async () => {
    const r = await runWeb(['--host', '0.0.0.0']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/not a loopback address; it requires --token/);
  });
});

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '..', 'dist', 'index.js');

function runCli(
  args: string[],
  home: string
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, HOME: home, AGENTDECK_MOCK_EXECUTION: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

/**
 * The orchestration engine hints users to run `agentdeck doctor <agentId>`;
 * before this positional existed, Commander silently ignored the argument and
 * checked every agent anyway. These tests pin the contract.
 */
describe('agentdeck doctor [agentId]', () => {
  it('advertises the optional positional in --help', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-doctor-'));
    try {
      const res = await runCli(['doctor', '--help'], home);
      expect(res.code).toBe(0);
      expect(res.stdout).toContain('doctor [options] [agentId]');
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  }, 20_000);

  it('fails with a non-zero exit and lists valid ids for an unknown agent', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-doctor-'));
    try {
      const res = await runCli(['doctor', 'definitely-not-an-agent'], home);
      expect(res.code).toBe(1);
      expect(res.stderr).toContain('No agent found matching "definitely-not-an-agent"');
      expect(res.stderr).toContain('claude-code');
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  }, 20_000);

  it('rejects an invalid --level with a non-zero exit', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-doctor-'));
    try {
      const res = await runCli(['doctor', '--level', 'level99_bogus'], home);
      expect(res.code).toBe(1);
      expect(res.stderr).toContain('Invalid --level');
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  }, 20_000);

  it('checks only the named agent when the positional is given', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-doctor-'));
    try {
      const res = await runCli(['doctor', 'claude-code'], home);
      expect(res.code).toBe(0);
      expect(res.stdout).toContain('(claude-code)');
      expect(res.stdout).not.toContain('(codex)');
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  }, 20_000);
});

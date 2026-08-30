import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { LlmRouting } from '@agentdeck/protocol';
import { isLlmConfigurable, type ApplyLlmConfigOptions } from '@agentdeck/adapter-sdk';
import { ClaudeCodeAdapter } from '../src/claude-code-adapter.js';
import { HermesAdapter } from '../src/hermes-adapter.js';
import { OpenClawAdapter } from '../src/openclaw-adapter.js';
import { GarraIAAdapter } from '../src/garraia-adapter.js';

const ROUTING: LlmRouting = {
  primary: {
    providerId: 'openrouter',
    model: 'z-ai/glm-5.3-flash',
    baseUrl: 'https://openrouter.ai/api/v1',
    credentialRef: 'file:openrouter',
  },
  backup: { providerId: 'ollama', model: 'qwen3.5:2b', baseUrl: 'http://127.0.0.1:11434/v1' },
  updatedAt: '2026-08-30T00:00:00.000Z',
};

const SECRET = 'sk-or-v1-abcdefghijklmnopqrstuvwxyz012345';

function opts(over: Partial<ApplyLlmConfigOptions> = {}): ApplyLlmConfigOptions {
  return {
    dryRun: false,
    force: false,
    resolveSecret: async (ref) => (ref === 'file:openrouter' ? SECRET : null),
    ...over,
  };
}

describe('isLlmConfigurable', () => {
  it('is true for the four managed agents', () => {
    for (const a of [
      new ClaudeCodeAdapter(),
      new HermesAdapter(),
      new OpenClawAdapter(),
      new GarraIAAdapter(),
    ]) {
      expect(isLlmConfigurable(a), a.definition.id).toBe(true);
    }
  });
});

describe('configFiles ⊆ backupConfig() manifest', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-invariant-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('never writes a file that rollback could not restore', async () => {
    // A file written but not backed up makes rollback() a silent no-op that
    // still reports success — exactly the Claude Code bug this pins shut.
    for (const adapter of [new ClaudeCodeAdapter(), new HermesAdapter(), new OpenClawAdapter()]) {
      const backup = await adapter.backupConfig(path.join(tmp, adapter.definition.id));
      const covered = new Set(backup.manifest.items.map((i) => i.sourcePath));
      for (const file of adapter.llmConfig.configFiles) {
        expect(covered.has(file), `${adapter.definition.id} writes ${file} without backing it up`).toBe(
          true
        );
      }
    }
  });
});

describe('backup strategy is declared honestly', () => {
  it('never claims a backup an agent cannot express', () => {
    expect(new GarraIAAdapter().llmConfig).toMatchObject({
      backupStrategy: 'native',
      supportsBackup: true,
    });
    expect(new OpenClawAdapter().llmConfig).toMatchObject({
      backupStrategy: 'native',
      supportsBackup: true,
    });
    // Claude Code has one model slot; the gateway does the failover for it.
    expect(new ClaudeCodeAdapter().llmConfig).toMatchObject({
      backupStrategy: 'via-gateway',
      supportsBackup: true,
    });
    // Hermes has neither, and says so.
    expect(new HermesAdapter().llmConfig).toMatchObject({
      backupStrategy: 'none',
      supportsBackup: false,
    });
  });
});

describe('applyLlmConfig — file-writing adapters', () => {
  let tmp: string;
  let realHome: string | undefined;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-home-'));
    realHome = process.env['HOME'];
    process.env['HOME'] = tmp;
    // These tests must NOT hit the AGENTDECK_MOCK_EXECUTION short-circuit:
    // applyLlmConfig writes files, it does not execute an agent, so mocking it
    // would prove nothing.
  });

  afterEach(async () => {
    if (realHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = realHome;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('writes OpenClaw primary + fallback and stores the key in env', async () => {
    const adapter = new OpenClawAdapter();
    const file = path.join(tmp, '.openclaw', 'openclaw.json');
    const result = await adapter.applyLlmConfig(ROUTING, opts());

    expect(result.changed).toBe(true);
    expect(result.filesWritten).toEqual([file]);
    const written = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(written.agents.defaults.model.primary).toBe('openrouter/z-ai/glm-5.3-flash');
    expect(written.agents.defaults.model.fallback).toBe('ollama/qwen3.5:2b');
    expect(written.env.OPENROUTER_API_KEY).toBe(SECRET);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });

  it('points Claude Code at the gateway and blanks a stale API key', async () => {
    const adapter = new ClaudeCodeAdapter();
    const file = path.join(tmp, '.claude', 'settings.json');
    await adapter.applyLlmConfig(ROUTING, opts());

    const written = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(written.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:3888');
    expect(written.env.ANTHROPIC_MODEL).toBe('z-ai/glm-5.3-flash');
    expect(written.env.ANTHROPIC_SMALL_FAST_MODEL).toBe('qwen3.5:2b');
    // A leftover ANTHROPIC_API_KEY outranks the auth token and would bypass us.
    expect(written.env.ANTHROPIC_API_KEY).toBe('');
    // The provider key must never reach this file — the gateway holds it.
    expect(await fs.readFile(file, 'utf8')).not.toContain(SECRET);
  });

  it('warns instead of faking a backup for Hermes', async () => {
    const adapter = new HermesAdapter();
    const result = await adapter.applyLlmConfig(ROUTING, opts());
    expect(result.warnings.join(' ')).toMatch(/no fallback slot/i);
    const written = JSON.parse(await fs.readFile(path.join(tmp, '.hermes', 'config.json'), 'utf8'));
    expect(written.model.primary).toBe('openrouter:z-ai/glm-5.3-flash');
  });

  it('is idempotent: a second identical apply writes nothing', async () => {
    const adapter = new OpenClawAdapter();
    const first = await adapter.applyLlmConfig(ROUTING, opts());
    expect(first.alreadyCurrent).toBe(false);

    const second = await adapter.applyLlmConfig(ROUTING, opts());
    expect(second.alreadyCurrent).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.filesWritten).toEqual([]);
  });

  it('preserves configuration the user wrote by hand', async () => {
    const file = path.join(tmp, '.openclaw', 'openclaw.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({ channels: { telegram: { token: 'keep-me' } }, gateway: { bind: 'loopback' } }),
      { mode: 0o600 }
    );

    await new OpenClawAdapter().applyLlmConfig(ROUTING, opts());

    const written = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(written.channels.telegram.token).toBe('keep-me');
    expect(written.gateway.bind).toBe('loopback');
    expect(written.agents.defaults.model.primary).toBe('openrouter/z-ai/glm-5.3-flash');
  });

  it('refuses to overwrite a hand-edited managed key without --force', async () => {
    const adapter = new OpenClawAdapter();
    const file = path.join(tmp, '.openclaw', 'openclaw.json');
    await adapter.applyLlmConfig(ROUTING, opts());

    const config = JSON.parse(await fs.readFile(file, 'utf8'));
    config.agents.defaults.model.primary = 'openrouter/something-i-chose';
    await fs.writeFile(file, JSON.stringify(config), { mode: 0o600 });

    await expect(adapter.applyLlmConfig(ROUTING, opts())).rejects.toThrow(/--force/);
    await expect(adapter.applyLlmConfig(ROUTING, opts({ force: true }))).resolves.toMatchObject({
      changed: true,
    });
  });

  it('dry run reports a diff and touches nothing', async () => {
    const adapter = new OpenClawAdapter();
    const file = path.join(tmp, '.openclaw', 'openclaw.json');
    const result = await adapter.applyLlmConfig(ROUTING, opts({ dryRun: true }));

    expect(result.changed).toBe(true);
    expect(result.filesWritten).toEqual([]);
    expect(result.diff.some((d) => d.key === 'agents.defaults.model.primary')).toBe(true);
    await expect(fs.access(file)).rejects.toThrow();
  });

  it('masks credentials in the diff', async () => {
    const result = await new OpenClawAdapter().applyLlmConfig(ROUTING, opts({ dryRun: true }));
    const secretEntry = result.diff.find((d) => d.key.includes('OPENROUTER_API_KEY'));
    expect(secretEntry?.redacted).toBe(true);
    expect(JSON.stringify(result.diff)).not.toContain(SECRET);
  });

  it('refuses to write a key into a world-readable config', async () => {
    const file = path.join(tmp, '.openclaw', 'openclaw.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{}', { mode: 0o644 });
    await fs.chmod(file, 0o644);

    await expect(new OpenClawAdapter().applyLlmConfig(ROUTING, opts())).rejects.toThrow(
      /readable by other users/
    );
  });

  it('refuses to overwrite a config it could not parse', async () => {
    const file = path.join(tmp, '.openclaw', 'openclaw.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ this is not json', { mode: 0o600 });

    await expect(new OpenClawAdapter().applyLlmConfig(ROUTING, opts())).rejects.toThrow(
      /not valid JSON/
    );
    // The unparseable original must survive untouched.
    expect(await fs.readFile(file, 'utf8')).toBe('{ this is not json');
  });
});

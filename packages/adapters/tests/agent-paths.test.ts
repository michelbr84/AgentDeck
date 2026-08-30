import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  compareSemver,
  isOutdated,
  parseSemver,
  resolveGarraiaConfigDir,
  resolveGarraiaConfigFile,
} from '../src/agent-paths.js';

describe('parseSemver', () => {
  it('extracts the triple from real --version output', () => {
    expect(parseSemver('garra 0.3.4')).toBe('0.3.4');
    expect(parseSemver('v1.0.4 (abc1234)')).toBe('1.0.4');
    expect(parseSemver('openclaw/2.11.0 linux-x64')).toBe('2.11.0');
  });

  it('returns null when there is no version to find', () => {
    expect(parseSemver('command not found')).toBeNull();
    expect(parseSemver('')).toBeNull();
  });
});

describe('compareSemver', () => {
  it('orders numerically, not lexically', () => {
    // The bug this replaces: "0.10.0" < "0.9.0" as strings.
    expect(compareSemver('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareSemver('0.3.4', '0.3.4')).toBe(0);
  });

  it('tolerates decorated input on either side', () => {
    expect(compareSemver('garra 0.3.4', '0.3.4')).toBe(0);
  });
});

describe('isOutdated', () => {
  it('is false when either side is unknown', () => {
    expect(isOutdated(null, '1.0.0')).toBe(false);
    expect(isOutdated('1.0.0', null)).toBe(false);
  });

  it('is false when the decorated installed string equals the latest', () => {
    // `"garra 0.3.4" !== "0.3.4"` was reporting every install as outdated.
    expect(isOutdated('garra 0.3.4', '0.3.4')).toBe(false);
  });

  it('is true only for a genuinely older install', () => {
    expect(isOutdated('0.3.3', '0.3.4')).toBe(true);
    expect(isOutdated('0.3.5', '0.3.4')).toBe(false);
  });
});

describe('resolveGarraiaConfigDir', () => {
  let tmp: string;
  const saved = {
    GARRAIA_CONFIG_DIR: process.env['GARRAIA_CONFIG_DIR'],
    XDG_CONFIG_HOME: process.env['XDG_CONFIG_HOME'],
  };

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-paths-'));
    delete process.env['GARRAIA_CONFIG_DIR'];
    process.env['XDG_CONFIG_HOME'] = path.join(tmp, 'xdg');
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('honours GARRAIA_CONFIG_DIR above everything else', async () => {
    process.env['GARRAIA_CONFIG_DIR'] = path.join(tmp, 'explicit');
    expect(await resolveGarraiaConfigDir()).toBe(path.join(tmp, 'explicit'));
  });

  it('prefers the XDG directory when it exists', async () => {
    const xdg = path.join(tmp, 'xdg', 'garraia');
    await fs.mkdir(xdg, { recursive: true });
    expect(await resolveGarraiaConfigDir()).toBe(xdg);
  });

  it('falls back to the XDG path for a fresh install', async () => {
    expect(await resolveGarraiaConfigDir()).toBe(path.join(tmp, 'xdg', 'garraia'));
  });

  it('prefers config.yml over config.toml', async () => {
    const dir = path.join(tmp, 'xdg', 'garraia');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'config.toml'), '');
    expect(await resolveGarraiaConfigFile()).toBe(path.join(dir, 'config.toml'));
    await fs.writeFile(path.join(dir, 'config.yml'), '');
    expect(await resolveGarraiaConfigFile()).toBe(path.join(dir, 'config.yml'));
  });
});

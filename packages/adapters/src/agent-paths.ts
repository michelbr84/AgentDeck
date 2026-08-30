/**
 * Shared filesystem + version helpers for the built-in adapters.
 *
 * These exist because each upstream agent resolves its own config location
 * differently, and getting it wrong makes `backupConfig()` silently back up
 * nothing and `rollback()` silently restore nothing.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/** `true` when the path exists and is readable. */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves GarraIA's effective config directory.
 *
 * Mirrors `garraia_config::loader::default_config_dir()` exactly:
 *   `GARRAIA_CONFIG_DIR` > `$XDG_CONFIG_HOME/garraia` (preferred for new
 *   installs) > `~/.garraia` (legacy). When neither exists yet, new installs
 *   get the XDG path.
 */
export async function resolveGarraiaConfigDir(): Promise<string> {
  const explicit = process.env['GARRAIA_CONFIG_DIR'];
  if (explicit) return explicit;

  const home = os.homedir();
  const xdgBase = process.env['XDG_CONFIG_HOME'] || path.join(home, '.config');
  const xdg = path.join(xdgBase, 'garraia');
  const legacy = path.join(home, '.garraia');

  if (await pathExists(xdg)) return xdg;
  if (await pathExists(legacy)) return legacy;
  return xdg;
}

/**
 * Resolves GarraIA's effective config file.
 *
 * `config.yml` wins over `config.toml`, matching the Rust loader's precedence.
 * Returns the path GarraIA *would* read even when nothing exists yet, so
 * callers can create it.
 */
export async function resolveGarraiaConfigFile(): Promise<string> {
  const dir = await resolveGarraiaConfigDir();
  const yml = path.join(dir, 'config.yml');
  if (await pathExists(yml)) return yml;
  const toml = path.join(dir, 'config.toml');
  if (await pathExists(toml)) return toml;
  return yml;
}

/**
 * Extracts a bare semver triple from arbitrary `--version` output.
 * `"garra 0.3.4"` and `"v0.3.4 (abc1234)"` both yield `"0.3.4"`.
 */
export function parseSemver(raw: string): string | null {
  const m = raw.match(/([0-9]+)\.([0-9]+)\.([0-9]+)/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/**
 * Semver-aware comparison. Returns <0, 0, >0 like a sort comparator.
 *
 * Anything unparseable sorts as `0.0.0` rather than throwing — an adapter that
 * cannot read its own version should not crash a scan.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string): [number, number, number] => {
    const m = parseSemver(v);
    if (!m) return [0, 0, 0];
    const [maj, min, pat] = m.split('.').map((n) => Number.parseInt(n, 10));
    return [maj ?? 0, min ?? 0, pat ?? 0];
  };
  const av = parse(a);
  const bv = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (av[i] ?? 0) - (bv[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** `true` when `installed` is strictly older than `latest`. */
export function isOutdated(installed: string | null, latest: string | null): boolean {
  if (!installed || !latest) return false;
  return compareSemver(installed, latest) < 0;
}

/**
 * Reads the latest release tag from a GitHub repo.
 *
 * Returns `null` on any failure — offline, rate-limited, or no releases yet.
 * Callers must treat `null` as "unknown", never as "outdated": reporting an
 * upgrade that cannot be performed is worse than reporting nothing.
 */
export async function fetchLatestGithubRelease(
  repo: string,
  timeoutMs = 8000
): Promise<{ version: string; notes?: string; htmlUrl?: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'agentdeck' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: string; body?: string; html_url?: string };
    const version = parseSemver(body.tag_name ?? '');
    if (!version) return null;
    return { version, notes: body.body, htmlUrl: body.html_url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

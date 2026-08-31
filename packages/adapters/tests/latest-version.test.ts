import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as adapterSdk from '@agentdeck/adapter-sdk';
import type { AgentAdapter, CommandOutput } from '@agentdeck/adapter-sdk';
import { ClaudeCodeAdapter } from '../src/claude-code-adapter.js';
import { ClineAdapter } from '../src/cline-adapter.js';
import { CodexAdapter } from '../src/codex-adapter.js';
import { KiloAdapter } from '../src/kilo-adapter.js';
import { PiAdapter } from '../src/pi-adapter.js';
import { OpenClawAdapter } from '../src/openclaw-adapter.js';
import { HermesAdapter } from '../src/hermes-adapter.js';
import { GarraIAAdapter } from '../src/garraia-adapter.js';
import { fetchLatestNpmVersion, parseNpmVersion } from '../src/agent-paths.js';

/**
 * `getLatestVersion()` honesty.
 *
 * Every built-in adapter short-circuits to a fixed value under VITEST /
 * NODE_ENV=test, so these tests deliberately leave test mode — that is the only
 * way to reach the real lookup. Before they do, every shell and network path is
 * stubbed: `executeSafeCommand` rejects and `fetch` throws unless a test says
 * otherwise, so nothing here can spawn `npm` or reach GitHub.
 *
 * The contract under test: a failed or unparseable lookup yields
 * `latestVersion: null` ("unknown"). `null` is what lets the manager's short
 * failure TTL and `isOutdated(v, null) === false` engage; a remembered constant
 * shows a stale "latest" and a false outdated/up-to-date instead.
 */

const NO_SHELL = new Error('executeSafeCommand must be stubbed per test — no shelling out');
const NO_NETWORK = new Error('fetch must be stubbed per test — no network');

const ok = (stdout: string): CommandOutput => ({ stdout, stderr: '', exitCode: 0 });
const failed = (stderr: string, exitCode = 1): CommandOutput => ({ stdout: '', stderr, exitCode });
const release = (tag: string): Response =>
  new Response(
    JSON.stringify({ tag_name: tag, body: 'release notes', html_url: `https://github.com/x/y/releases/tag/${tag}` }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );

const spyExec = () => vi.spyOn(adapterSdk, 'executeSafeCommand');
let exec: ReturnType<typeof spyExec>;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  vi.stubEnv('VITEST', '');
  vi.stubEnv('NODE_ENV', 'development');
  exec = spyExec().mockRejectedValue(NO_SHELL);
  fetchMock = vi.fn<typeof fetch>().mockRejectedValue(NO_NETWORK);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NPM_BACKED: { name: string; make: () => AgentAdapter; pkg: string; pinned: string }[] = [
  { name: 'claude-code', make: () => new ClaudeCodeAdapter(), pkg: '@anthropic-ai/claude-code', pinned: '2.1.237' },
  { name: 'cline', make: () => new ClineAdapter(), pkg: 'cline', pinned: '3.5.0' },
  { name: 'codex', make: () => new CodexAdapter(), pkg: '@openai/codex', pinned: '1.2.0' },
  { name: 'kilo', make: () => new KiloAdapter(), pkg: '@kilocode/cli', pinned: '0.9.4' },
  { name: 'pi', make: () => new PiAdapter(), pkg: '@mariozechner/pi-coding-agent', pinned: '1.2.0' },
  { name: 'openclaw', make: () => new OpenClawAdapter(), pkg: 'openclaw', pinned: '2026.7.1-2' },
];

describe.each(NPM_BACKED)('$name getLatestVersion() via npm view', ({ make, pkg, pinned }) => {
  it('reports the version npm published, from the real package', async () => {
    exec.mockResolvedValue(ok('9.9.9\n'));

    const result = await make().getLatestVersion();

    expect(result.latestVersion).toBe('9.9.9');
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'npm', args: ['view', pkg, 'version'], timeoutMs: expect.any(Number) })
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports unknown (null), not the old pinned constant, when npm exits non-zero', async () => {
    // executeSafeCommand resolves with the exit code rather than throwing, so a
    // registry error looks like `{ exitCode: 1, stdout: '' }` — the case the
    // old `res.stdout.trim() || '<pinned>'` fallback silently papered over.
    exec.mockResolvedValue(failed('npm ERR! code E404'));

    const result = await make().getLatestVersion();

    expect(result.latestVersion).toBeNull();
    expect(result.latestVersion).not.toBe(pinned);
  });

  it('reports unknown when npm cannot be spawned or times out', async () => {
    // beforeEach leaves executeSafeCommand rejecting.
    const result = await make().getLatestVersion();
    expect(result.latestVersion).toBeNull();
  });

  it('reports unknown when the output is not a version', async () => {
    exec.mockResolvedValue(ok('npm notice New major version of npm available!\n'));
    const result = await make().getLatestVersion();
    expect(result.latestVersion).toBeNull();
  });

  it('keeps its fixed test-mode value under VITEST without touching npm', async () => {
    vi.stubEnv('VITEST', 'true');
    const result = await make().getLatestVersion();
    expect(result.latestVersion).toBe(pinned);
    expect(exec).not.toHaveBeenCalled();
  });
});

const GITHUB_BACKED: { name: string; make: () => AgentAdapter; repo: string }[] = [
  { name: 'hermes', make: () => new HermesAdapter(), repo: 'NousResearch/hermes-agent' },
  { name: 'garraia', make: () => new GarraIAAdapter(), repo: 'michelbr84/GarraRUST' },
];

describe.each(GITHUB_BACKED)('$name getLatestVersion() via GitHub releases', ({ make, repo }) => {
  it('reports the latest release tag from the upstream repo', async () => {
    fetchMock.mockResolvedValue(release('v0.21.0'));

    const result = await make().getLatestVersion();

    expect(result.latestVersion).toBe('0.21.0');
    expect(result.releaseNotes).toBe('release notes');
    expect(result.downloadUrl).toContain('v0.21.0');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`https://api.github.com/repos/${repo}/releases/latest`);
    expect(exec).not.toHaveBeenCalled();
  });

  it('reports unknown (null) when the API answers with an error', async () => {
    fetchMock.mockResolvedValue(new Response('rate limited', { status: 403 }));
    const result = await make().getLatestVersion();
    expect(result.latestVersion).toBeNull();
  });

  it('reports unknown (null) when offline, without shelling out for a substitute', async () => {
    // beforeEach leaves fetch throwing. The old GarraIA fallback ran detect()
    // here and reported the *installed* version as "latest" — or the literal
    // string 'unknown', which `isOutdated` cannot tell from a real version.
    const result = await make().getLatestVersion();

    expect(result.latestVersion).toBeNull();
    expect(result.latestVersion).not.toBe('unknown');
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('hermes test-mode short-circuit', () => {
  it('keeps its fixed value under VITEST without touching the network', async () => {
    vi.stubEnv('VITEST', 'true');
    const result = await new HermesAdapter().getLatestVersion();
    expect(result.latestVersion).toBe('0.20.0');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('no built-in adapter fabricates a latest version', () => {
  it('reports null for every adapter when every lookup fails', async () => {
    const adapters: AgentAdapter[] = [
      new ClaudeCodeAdapter(),
      new ClineAdapter(),
      new CodexAdapter(),
      new KiloAdapter(),
      new PiAdapter(),
      new OpenClawAdapter(),
      new HermesAdapter(),
      new GarraIAAdapter(),
    ];
    for (const adapter of adapters) {
      const result = await adapter.getLatestVersion();
      expect(result.latestVersion, adapter.definition.id).toBeNull();
    }
  });
});

describe('parseNpmVersion', () => {
  it('accepts what `npm view <pkg> version` prints', () => {
    expect(parseNpmVersion('2.1.237\n')).toBe('2.1.237');
    expect(parseNpmVersion('  1.2.0  ')).toBe('1.2.0');
    expect(parseNpmVersion("'0.9.4'")).toBe('0.9.4');
  });

  it('keeps pre-release and build suffixes intact', () => {
    // The CLI wizard compares installed and latest as strings; truncating
    // `2026.7.1-2` to `2026.7.1` would flag every such install as outdated.
    expect(parseNpmVersion('2026.7.1-2')).toBe('2026.7.1-2');
    expect(parseNpmVersion('1.0.0-beta.3+build.7')).toBe('1.0.0-beta.3+build.7');
  });

  it('rejects anything that is not a version', () => {
    expect(parseNpmVersion('')).toBeNull();
    expect(parseNpmVersion('npm ERR! code E404')).toBeNull();
    expect(parseNpmVersion('1.2')).toBeNull();
    expect(parseNpmVersion('latest: 1.2.3 (see changelog)')).toBeNull();
  });
});

describe('fetchLatestNpmVersion', () => {
  it('runs `npm view <pkg> version` with a timeout', async () => {
    exec.mockResolvedValue(ok('4.5.6'));
    expect(await fetchLatestNpmVersion('some-pkg')).toBe('4.5.6');
    expect(exec).toHaveBeenCalledWith({ command: 'npm', args: ['view', 'some-pkg', 'version'], timeoutMs: 15000 });
  });

  it('honours a caller-supplied timeout', async () => {
    exec.mockResolvedValue(ok('4.5.6'));
    await fetchLatestNpmVersion('some-pkg', 1234);
    expect(exec).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 1234 }));
  });

  it('returns null on a non-zero exit even if stdout looks like a version', async () => {
    exec.mockResolvedValue({ stdout: '1.0.0', stderr: 'boom', exitCode: 1 });
    expect(await fetchLatestNpmVersion('some-pkg')).toBeNull();
  });

  it('returns null when the command rejects', async () => {
    expect(await fetchLatestNpmVersion('some-pkg')).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentDeckDatabase } from '@agentdeck/database';
import type { AgentAdapter, DetectionResult } from '@agentdeck/adapter-sdk';
import type { HealthReport } from '@agentdeck/protocol';
import { AgentDeckManager } from '../src/agent-deck-manager.js';

/**
 * The manager keeps one static cache of "latest version" answers so a scan
 * does not hit the network for every agent every time. These tests pin down
 * its two failure modes: a lookup failure must not be remembered for the full
 * hour (`isOutdated(v, null)` is false, so that pins every agent to "up to
 * date"), and anything that changes what is installed must drop the entry.
 */

const TARGET = 'claude-code';
const BYSTANDER = 'hermes';
const T0 = new Date('2026-08-30T12:00:00Z').getTime();
const HOUR = AgentDeckManager.VERSION_CACHE_TTL_MS;
const FAILURE_TTL = AgentDeckManager.VERSION_FAILURE_TTL_MS;

const detected = (version: string): DetectionResult => ({
  installed: true,
  binaryPath: '/usr/local/bin/fake-agent',
  version,
  state: {
    availability: 'available',
    installation: 'installed',
    configuration: 'configured',
    authentication: 'unknown',
    health: 'unknown',
    version: 'current',
    runtime: 'stopped',
  },
});

const healthy = (): HealthReport => ({
  agentDefinitionId: TARGET,
  checkedAt: new Date().toISOString(),
  level: 'level1_static',
  overallStatus: 'healthy',
  diagnostics: [],
});

const spyDetect = (adapter: AgentAdapter) =>
  vi.spyOn(adapter, 'detect').mockResolvedValue(detected('1.0.0'));
const spyLookup = (adapter: AgentAdapter) =>
  vi.spyOn(adapter, 'getLatestVersion').mockResolvedValue({ latestVersion: '1.0.0' });

/**
 * In-memory manager whose built-in adapters never touch the shell or the
 * network: every `detect`/`getLatestVersion` is stubbed. The spies for the
 * adapter under test (and one bystander's lookup) come back so tests can
 * drive and count the lookups.
 */
async function makeManager() {
  const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
  await db.migrate();
  const manager = AgentDeckManager.createWithDatabase(db);

  const spies = manager.getAllAdapters().map((adapter) => ({
    id: adapter.definition.id,
    adapter,
    detect: spyDetect(adapter),
    lookup: spyLookup(adapter),
  }));
  const target = spies.find((s) => s.id === TARGET);
  const other = spies.find((s) => s.id === BYSTANDER);
  if (!target || !other) throw new Error('built-in adapters missing from the registry');

  return { manager, ...target, bystander: other.lookup };
}

async function scanOne(manager: AgentDeckManager) {
  const all = await manager.scanAndSyncInstallations();
  const inst = all.find((i) => i.definitionId === TARGET);
  if (!inst) throw new Error(`${TARGET} missing from scan`);
  return inst;
}

describe('AgentDeckManager latest-version cache', () => {
  beforeEach(() => {
    // The cache is static: never let one test's entries leak into the next.
    AgentDeckManager.invalidateVersionCache();
    // Fake only the clock. Timers stay real so nothing in the scan can hang.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries a failed lookup after the short failure TTL, not after an hour', async () => {
    // The requirement is "recovers within a minute", so pin the bound itself:
    // the timing assertions below follow the constant and would not notice
    // it being raised back to an hour.
    expect(FAILURE_TTL).toBeLessThanOrEqual(60 * 1000);

    const { manager, lookup } = await makeManager();
    lookup.mockRejectedValueOnce(new Error('ENETUNREACH'));

    let inst = await scanOne(manager);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(inst.versionLatest).toBeNull();

    // Inside the failure window the miss is served from cache: no retry storm.
    vi.setSystemTime(T0 + FAILURE_TTL - 1);
    inst = await scanOne(manager);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(inst.versionLatest).toBeNull();

    // Once it elapses the lookup runs again and the real answer comes through.
    lookup.mockResolvedValueOnce({ latestVersion: '2.0.0' });
    vi.setSystemTime(T0 + FAILURE_TTL);
    inst = await scanOne(manager);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(inst.versionLatest).toBe('2.0.0');
    expect(inst.state.version).toBe('outdated');
  });

  it('treats a null latestVersion (adapter could not tell) like a failure', async () => {
    const { manager, lookup } = await makeManager();
    lookup.mockResolvedValueOnce({ latestVersion: null });

    let inst = await scanOne(manager);
    expect(inst.versionLatest).toBeNull();

    lookup.mockResolvedValueOnce({ latestVersion: '2.0.0' });
    vi.setSystemTime(T0 + FAILURE_TTL);
    inst = await scanOne(manager);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(inst.versionLatest).toBe('2.0.0');
  });

  it('caches a successful lookup for an hour', async () => {
    const { manager, lookup } = await makeManager();
    lookup.mockResolvedValue({ latestVersion: '2.0.0' });

    let inst = await scanOne(manager);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(inst.state.version).toBe('outdated');

    vi.setSystemTime(T0 + HOUR - 1);
    inst = await scanOne(manager);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(inst.versionLatest).toBe('2.0.0');

    vi.setSystemTime(T0 + HOUR);
    await scanOne(manager);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('invalidateVersionCache(id) forces a fresh lookup for that adapter only', async () => {
    const { manager, lookup, bystander } = await makeManager();
    lookup.mockResolvedValueOnce({ latestVersion: '1.0.0' });

    let inst = await scanOne(manager);
    expect(inst.state.version).toBe('current');

    // A newer release appears upstream; the cache still says 1.0.0.
    lookup.mockResolvedValue({ latestVersion: '2.0.0' });
    inst = await scanOne(manager);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(inst.versionLatest).toBe('1.0.0');

    AgentDeckManager.invalidateVersionCache(TARGET);
    inst = await scanOne(manager);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(inst.versionLatest).toBe('2.0.0');
    expect(inst.state.version).toBe('outdated');
    // The other agents' entries were left alone.
    expect(bystander).toHaveBeenCalledTimes(1);

    AgentDeckManager.invalidateVersionCache();
    await scanOne(manager);
    expect(lookup).toHaveBeenCalledTimes(3);
    expect(bystander).toHaveBeenCalledTimes(2);
  });

  it('an upgrade run through the manager engine drops the cached entry', async () => {
    const { manager, adapter, lookup, detect } = await makeManager();
    lookup.mockResolvedValue({ latestVersion: '2.0.0' });
    await scanOne(manager);
    expect(lookup).toHaveBeenCalledTimes(1);

    vi.spyOn(adapter, 'backupConfig').mockResolvedValue({
      backupPath: '/nonexistent/backup',
      manifest: { agentDefinitionId: TARGET, items: [] },
      backedUpFiles: [],
      skippedFiles: [],
      timestamp: new Date().toISOString(),
    });
    vi.spyOn(adapter, 'upgrade').mockImplementation(async () => {
      detect.mockResolvedValue(detected('2.0.0'));
    });
    vi.spyOn(adapter, 'checkHealth').mockResolvedValue(healthy());

    const result = await manager.upgradeEngine.executeUpgrade(adapter);
    expect(result.success).toBe(true);
    // The plan asks the adapter directly (uncached): that is call #2.
    expect(lookup).toHaveBeenCalledTimes(2);

    // Same instant, so only a dropped entry explains a third lookup.
    const inst = await scanOne(manager);
    expect(lookup).toHaveBeenCalledTimes(3);
    expect(inst.versionInstalled).toBe('2.0.0');
    expect(inst.state.version).toBe('current');
  });
});

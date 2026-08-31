import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AgentDeckDatabase } from '@agentdeck/database';
import type { LlmRouting } from '@agentdeck/protocol';
import type { AgentAdapter, BackupResult, LlmConfigurable } from '@agentdeck/adapter-sdk';
import { RoutingService } from '../src/routing-service.js';

const ROUTING: LlmRouting = {
  primary: { providerId: 'openrouter', model: 'z-ai/glm-5.3-flash', credentialRef: 'file:openrouter' },
  backup: { providerId: 'ollama', model: 'qwen3.5:2b' },
  updatedAt: '2026-08-30T00:00:00.000Z',
};

/**
 * A configurable adapter that records every routing it is handed, split by
 * dry-run vs. real apply, and writes a JSON file so rollback has something to
 * look at. No real agent config is touched.
 */
function fakeAdapter(id: string, home: string) {
  const file = path.join(home, id, 'config.json');
  const applied: LlmRouting[] = [];
  const dryRuns: LlmRouting[] = [];
  const adapter = {
    definition: { id, name: id.toUpperCase() },
    llmConfig: {
      backupStrategy: 'native',
      supportsBackup: true,
      keyDelivery: 'config-file',
      configFiles: [file],
    },
    async backupConfig(backupDir: string): Promise<BackupResult> {
      return {
        backupPath: backupDir,
        manifest: {
          agentDefinitionId: id,
          items: [{ sourcePath: file, relativePath: 'config.json', description: '', required: false }],
        },
        backedUpFiles: [],
        skippedFiles: ['config.json'],
        timestamp: new Date().toISOString(),
      };
    },
    async rollback(): Promise<void> {},
    async readLlmConfig() {
      return {
        primary: null,
        backup: null,
        managedByAgentDeck: false,
        routingHash: null,
        drift: [],
        warnings: [],
      };
    },
    async applyLlmConfig(routing: LlmRouting, opts: { dryRun: boolean }) {
      (opts.dryRun ? dryRuns : applied).push(routing);
      if (!opts.dryRun) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, JSON.stringify(routing), { mode: 0o600 });
      }
      return {
        changed: !opts.dryRun,
        alreadyCurrent: false,
        diff: [],
        filesWritten: opts.dryRun ? [] : [file],
        backup: null,
        warnings: [],
      };
    },
  } as unknown as AgentAdapter & LlmConfigurable;
  return { adapter, file, applied, dryRuns };
}

describe('RoutingService', () => {
  let tmp: string;
  let db: AgentDeckDatabase;
  let service: RoutingService;
  let realHome: string | undefined;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-routing-'));
    // AGENTDECK_PATHS derives the backups dir from the home dir; point it at
    // the sandbox so an apply never writes into the real ~/.agentdeck.
    realHome = process.env['HOME'];
    process.env['HOME'] = tmp;
    const dbPath = path.join(tmp, 'test.db');
    db = new AgentDeckDatabase({ dbPath });
    await db.migrate();
    await fs.stat(dbPath); // the real file, not an anonymous in-memory database
    service = new RoutingService(db, path.join(tmp, 'secrets'));
  });

  afterEach(async () => {
    if (realHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = realHome;
    await db.close();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('returns null before the user has chosen a routing', async () => {
    expect(await service.getRouting()).toBeNull();
  });

  it('round-trips the deck routing', async () => {
    await service.setRouting(ROUTING);
    expect(await service.getRouting()).toEqual(ROUTING);
  });

  it('upserts rather than duplicating the singleton row', async () => {
    await service.setRouting(ROUTING);
    await service.setRouting({
      ...ROUTING,
      primary: { providerId: 'ollama', model: 'qwen3.5:2b' },
      updatedAt: '2026-08-31T00:00:00.000Z',
    });
    const rows = await db.db.selectFrom('llm_routing').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect((await service.getRouting())?.primary.providerId).toBe('ollama');
  });

  it('stores a routing with no backup', async () => {
    const noBackup: LlmRouting = { primary: ROUTING.primary, updatedAt: ROUTING.updatedAt };
    await service.setRouting(noBackup);
    const read = await service.getRouting();
    expect(read?.backup).toBeUndefined();
  });

  it('never persists a credential value, only its reference', async () => {
    await service.secretStore.set('openrouter', 'sk-or-v1-abcdefghijklmnopqrstuv');
    await service.setRouting(ROUTING);
    const row = await db.db.selectFrom('llm_routing').selectAll().executeTakeFirst();
    expect(row?.primary_json).toContain('file:openrouter');
    expect(JSON.stringify(row)).not.toContain('sk-or-v1');
  });

  it('keeps per-instance overrides separate from the deck default', async () => {
    await service.setRouting(ROUTING);
    // No override until one is set.
    expect(await service.getOverride('inst-x')).toBeNull();
  });

  it('lists no runs when nothing has been applied', async () => {
    expect(await service.listRuns()).toEqual([]);
  });

  describe('applyToAgents with per-agent overrides', () => {
    const B_ROUTING: LlmRouting = {
      ...ROUTING,
      primary: { providerId: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
    };
    const RUN_ID = '2026-08-31T00-00-00-000Z';

    it('writes the deck routing to one agent and the override to the other', async () => {
      const a = fakeAdapter('agent-a', tmp);
      const b = fakeAdapter('agent-b', tmp);

      const report = await service.applyToAgents([a.adapter, b.adapter], ROUTING, {
        runId: RUN_ID,
        dryRun: false,
        overrides: { 'agent-b': B_ROUTING },
      });

      expect(a.applied).toEqual([ROUTING]);
      expect(b.applied).toEqual([B_ROUTING]);
      // The pre-write dry-run gate must exercise the same routing each agent will get.
      expect(a.dryRuns).toEqual([ROUTING]);
      expect(b.dryRuns).toEqual([B_ROUTING]);
      expect(JSON.parse(await fs.readFile(a.file, 'utf8'))).toEqual(ROUTING);
      expect(JSON.parse(await fs.readFile(b.file, 'utf8'))).toEqual(B_ROUTING);

      expect(report.routing).toEqual(ROUTING);
      expect(report.overrides).toEqual({ 'agent-b': B_ROUTING });
      expect(report.outcomes.map((o) => [o.agentId, o.status])).toEqual([
        ['agent-a', 'applied'],
        ['agent-b', 'applied'],
      ]);
      expect(report.partial).toBe(false);
    });

    it('records in the one manifest which routing each agent was given', async () => {
      const a = fakeAdapter('agent-a', tmp);
      const b = fakeAdapter('agent-b', tmp);
      const report = await service.applyToAgents([a.adapter, b.adapter], ROUTING, {
        runId: RUN_ID,
        dryRun: false,
        overrides: { 'agent-b': B_ROUTING },
      });

      expect(report.backupDir).toBe(service.backupDirFor(RUN_ID));
      const manifest = JSON.parse(
        await fs.readFile(path.join(report.backupDir, 'manifest.json'), 'utf8')
      );
      expect(manifest.runId).toBe(RUN_ID);
      expect(manifest.routing).toEqual(ROUTING);
      expect(manifest.overrides).toEqual({ 'agent-b': B_ROUTING });
      expect(manifest.agents.map((e: { id: string; routing: LlmRouting }) => [e.id, e.routing])).toEqual([
        ['agent-a', ROUTING],
        ['agent-b', B_ROUTING],
      ]);

      // The run is listed and can be rolled back agent by agent as before.
      expect((await service.listRuns()).map((r) => r.runId)).toEqual([RUN_ID]);
      const rolled = await service.rollbackRun(RUN_ID, [a.adapter, b.adapter]);
      expect(rolled.map((r) => r.agentId)).toEqual(['agent-a', 'agent-b']);
      expect(rolled.every((r) => r.reason?.startsWith('nothing to restore'))).toBe(true);
    });

    it('reports both routings on a dry run without writing anything', async () => {
      const a = fakeAdapter('agent-a', tmp);
      const b = fakeAdapter('agent-b', tmp);
      const report = await service.applyToAgents([a.adapter, b.adapter], ROUTING, {
        runId: RUN_ID,
        dryRun: true,
        overrides: { 'agent-b': B_ROUTING },
      });

      expect(a.dryRuns).toEqual([ROUTING]);
      expect(b.dryRuns).toEqual([B_ROUTING]);
      expect(a.applied).toEqual([]);
      expect(b.applied).toEqual([]);
      expect(report.overrides).toEqual({ 'agent-b': B_ROUTING });
      expect(report.outcomes.map((o) => o.status)).toEqual(['applied', 'applied']);

      await expect(fs.stat(a.file)).rejects.toThrow();
      await expect(fs.stat(b.file)).rejects.toThrow();
      await expect(fs.stat(report.backupDir)).rejects.toThrow();
      expect(await service.listRuns()).toEqual([]);
    });

    it('ignores an override for an agent that is not in the run', async () => {
      const a = fakeAdapter('agent-a', tmp);
      const b = fakeAdapter('agent-b', tmp);
      const report = await service.applyToAgents([a.adapter, b.adapter], ROUTING, {
        runId: RUN_ID,
        dryRun: false,
        overrides: { ghost: B_ROUTING },
      });

      expect(a.applied).toEqual([ROUTING]);
      expect(b.applied).toEqual([ROUTING]);
      expect(report.overrides).toEqual({});
      const manifest = JSON.parse(
        await fs.readFile(path.join(report.backupDir, 'manifest.json'), 'utf8')
      );
      expect(manifest.overrides).toEqual({});
      expect(manifest.agents.map((e: { routing: LlmRouting }) => e.routing)).toEqual([
        ROUTING,
        ROUTING,
      ]);
    });

    it('applies the deck routing everywhere when no overrides are given', async () => {
      const a = fakeAdapter('agent-a', tmp);
      const b = fakeAdapter('agent-b', tmp);
      const report = await service.applyToAgents([a.adapter, b.adapter], ROUTING, {
        runId: RUN_ID,
        dryRun: false,
      });
      expect(a.applied).toEqual([ROUTING]);
      expect(b.applied).toEqual([ROUTING]);
      expect(report.overrides).toEqual({});
    });
  });
});

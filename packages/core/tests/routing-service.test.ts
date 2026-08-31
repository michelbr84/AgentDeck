import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AgentDeckDatabase } from '@agentdeck/database';
import type { LlmRouting } from '@agentdeck/protocol';
import { RoutingService } from '../src/routing-service.js';

const ROUTING: LlmRouting = {
  primary: { providerId: 'openrouter', model: 'z-ai/glm-5.3-flash', credentialRef: 'file:openrouter' },
  backup: { providerId: 'ollama', model: 'qwen3.5:2b' },
  updatedAt: '2026-08-30T00:00:00.000Z',
};

describe('RoutingService', () => {
  let tmp: string;
  let db: AgentDeckDatabase;
  let service: RoutingService;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-routing-'));
    db = new AgentDeckDatabase(path.join(tmp, 'test.db'));
    await db.migrate();
    service = new RoutingService(db, path.join(tmp, 'secrets'));
  });

  afterEach(async () => {
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
});

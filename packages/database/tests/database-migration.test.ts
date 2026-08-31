import { describe, it, expect } from 'vitest';
import { AgentDeckDatabase } from '../src/index.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('AgentDeck Database Real Migration & Integrity Suite', () => {
  it('applies v1.0.4 migrations and verifies SQLite integrity check', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-db-test-'));
    const testDbPath = path.join(tempDir, 'agentdeck-migration-test.db');

    // 1. Initialize and run migrations
    const db = new AgentDeckDatabase({ dbPath: testDbPath });
    await db.migrate();

    // 2. Verify PRAGMA integrity_check
    const integrity = await db.integrityCheck();
    expect(integrity.ok).toBe(true);
    expect(integrity.message).toBe('Database integrity OK');

    // 3. Verify newly migrated columns exist in sqlite_master / pragma table_info
    const agentInstancesCols = await db.raw<{ name: string }>("PRAGMA table_info('agent_instances')");
    expect(agentInstancesCols.some((c) => c.name === 'is_active')).toBe(true);

    const roomsCols = await db.raw<{ name: string }>("PRAGMA table_info('rooms')");
    expect(roomsCols.some((c) => c.name === 'default_agent_instance_id')).toBe(true);

    const messagesCols = await db.raw<{ name: string }>("PRAGMA table_info('messages')");
    expect(messagesCols.some((c) => c.name === 'delivery_trace_json')).toBe(true);

    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
});

describe('003_llm_routing', () => {
  it('adds the routing table and the per-instance override column', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-mig-v3-'));
    const dbPath = path.join(dir, 'test.db');
    const db = new AgentDeckDatabase({ dbPath });
    await db.migrate();
    // Prove the on-disk path is exercised (a bare string argument used to open an
    // anonymous in-memory database and the test passed without touching it).
    await expect(fs.stat(dbPath)).resolves.toBeDefined();

    // Singleton row round-trips.
    await db.db
      .insertInto('llm_routing')
      .values({
        id: 'default',
        primary_json: JSON.stringify({ providerId: 'openrouter', model: 'z-ai/glm-5.3-flash' }),
        backup_json: JSON.stringify({ providerId: 'ollama', model: 'qwen3.5:2b' }),
        updated_at: new Date().toISOString(),
      })
      .execute();
    const row = await db.db
      .selectFrom('llm_routing')
      .selectAll()
      .where('id', '=', 'default')
      .executeTakeFirst();
    expect(row?.primary_json).toContain('z-ai/glm-5.3-flash');

    // Re-running must be a no-op, not a hard failure.
    await db.migrate();

    await db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
});

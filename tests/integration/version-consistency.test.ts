import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTDECK_VERSION } from '../../packages/shared/src/index.js';
import { createAgentDeckServer } from '../../packages/server/src/index.js';
import { AgentDeckManager } from '../../packages/core/src/index.js';
import { AgentDeckDatabase } from '../../packages/database/src/index.js';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const rootDir = path.resolve(currentDir, '..', '..');

describe('Version Consistency & Release Metadata', () => {
  it('canonical AGENTDECK_VERSION is a valid semver string', () => {
    expect(AGENTDECK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('root package.json version matches canonical version', () => {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
    expect(rootPkg.version).toBe(AGENTDECK_VERSION);
  });

  it('apps/cli package.json version matches canonical version', () => {
    const cliPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'apps', 'cli', 'package.json'), 'utf-8'));
    expect(cliPkg.version).toBe(AGENTDECK_VERSION);
  });

  it('apps/web package.json version matches canonical version', () => {
    const webPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'apps', 'web', 'package.json'), 'utf-8'));
    expect(webPkg.version).toBe(AGENTDECK_VERSION);
  });

  it('scripts/install.sh FALLBACK_VERSION matches canonical version', () => {
    const installScript = fs.readFileSync(path.join(rootDir, 'scripts', 'install.sh'), 'utf-8');
    const match = installScript.match(/FALLBACK_VERSION="([^"]+)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(`v${AGENTDECK_VERSION}`);
  });

  it('server /health endpoint reports canonical version', async () => {
    // In-memory manager: running the suite must not create ~/.agentdeck/data/agentdeck.db.
    const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);
    const server = await createAgentDeckServer({ port: 0, manager });
    try {
      const res = await server.inject({
        method: 'GET',
        url: '/health',
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('healthy');
      expect(body.version).toBe(AGENTDECK_VERSION);
    } finally {
      await server.close();
      db.close();
    }
  });
});

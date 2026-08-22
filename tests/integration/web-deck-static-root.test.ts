import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createAgentDeckServer, resolveWebRoot } from '../../packages/server/src/index.js';
import { AgentDeckManager } from '../../packages/core/src/index.js';
import { AgentDeckDatabase } from '../../packages/database/src/index.js';
import { AGENTDECK_VERSION } from '../../packages/shared/src/index.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCAL_WEB_DIST = path.join(REPO_ROOT, 'apps', 'web', 'dist');
const PACKAGED_WEB_DIST = path.join(os.homedir(), '.agentdeck', 'app', 'web', 'dist');

const sha256 = (buf: Buffer | string) => crypto.createHash('sha256').update(buf).digest('hex');

describe('Web Deck static root resolution (v1.0.4 regression)', () => {
  it('resolves the local monorepo apps/web/dist and never the packaged ~/.agentdeck fallback', () => {
    const resolved = resolveWebRoot();
    expect(resolved).toBe(LOCAL_WEB_DIST);
    expect(resolved).not.toBe(PACKAGED_WEB_DIST);
    expect(fs.existsSync(path.join(resolved!, 'index.html'))).toBe(true);
  });

  it('resolves the local monorepo bundle from the COMPILED server module too (packaged dist layout)', async () => {
    const compiled = path.join(REPO_ROOT, 'packages', 'server', 'dist', 'index.js');
    expect(fs.existsSync(compiled)).toBe(true);
    const mod = await import(compiled);
    expect(mod.resolveWebRoot()).toBe(LOCAL_WEB_DIST);
  });

  it('rejects an invalid explicit --web-root instead of silently falling back', () => {
    expect(() => resolveWebRoot(path.join(REPO_ROOT, 'does', 'not', 'exist'))).toThrow(/not found/i);
  });

  it('serves the byte-identical index.html from the local build and reports build provenance', async () => {
    const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);
    const server = await createAgentDeckServer({ port: 0, manager });

    expect(server.webRoot).toBe(LOCAL_WEB_DIST);

    const onDisk = fs.readFileSync(path.join(LOCAL_WEB_DIST, 'index.html'));
    const served = await server.inject({ method: 'GET', url: '/' });
    expect(served.statusCode).toBe(200);
    expect(sha256(served.rawPayload)).toBe(sha256(onDisk));

    const buildInfo = await server.inject({ method: 'GET', url: '/api/v1/build-info' });
    expect(buildInfo.statusCode).toBe(200);
    const info = JSON.parse(buildInfo.body);
    expect(info.version).toBe(AGENTDECK_VERSION);
    expect(info.webRoot).toBe(LOCAL_WEB_DIST);
    expect(info.buildId).toBeTruthy();

    const health = await server.inject({ method: 'GET', url: '/health' });
    expect(JSON.parse(health.body).webRoot).toBe(LOCAL_WEB_DIST);

    await server.close();
  });

  it('serves assets created AFTER the daemon started (rebuild while running)', async () => {
    const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);
    const server = await createAgentDeckServer({ port: 0, manager });

    const probe = path.join(LOCAL_WEB_DIST, 'assets', 'static-root-probe.js');
    try {
      fs.writeFileSync(probe, '// regression probe\n');
      const res = await server.inject({ method: 'GET', url: '/assets/static-root-probe.js' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('regression probe');
    } finally {
      fs.rmSync(probe, { force: true });
      await server.close();
    }
  });

  it('keeps the SPA fallback and JSON 404s intact', async () => {
    const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);
    const server = await createAgentDeckServer({ port: 0, manager });

    const spa = await server.inject({ method: 'GET', url: '/rooms' });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain('<div id="root"></div>');

    const missingAsset = await server.inject({ method: 'GET', url: '/assets/nope.js' });
    expect(missingAsset.statusCode).toBe(404);

    const missingApi = await server.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(missingApi.statusCode).toBe(404);
    expect(JSON.parse(missingApi.body).error).toBe('Not Found');

    await server.close();
  });

  it('ships the Create Room and Add Agent to Room controls in the built bundle', () => {
    const assetsDir = path.join(LOCAL_WEB_DIST, 'assets');
    const bundle = fs
      .readdirSync(assetsDir)
      .filter((f) => f.endsWith('.js'))
      .map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf-8'))
      .join('\n');
    expect(bundle).toContain('Create Room');
    expect(bundle).toContain('Add Agent to Room');
  });
});

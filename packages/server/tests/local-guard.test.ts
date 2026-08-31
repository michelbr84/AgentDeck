import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentDeckManager } from '@agentdeck/core';
import { AgentDeckDatabase } from '@agentdeck/database';
import { createAgentDeckServer, isLoopbackHost, type AgentDeckServerInstance } from '../src/index.js';

/**
 * Local request guard (no-token mode).
 *
 * Without --token the daemon binds to loopback, but a browser can still be
 * steered at it: DNS rebinding delivers the attacker's hostname in `Host`, and a
 * cross-site fetch or WebSocket upgrade carries a foreign `Origin`. Both must be
 * loopback literals. Local CLIs, curl and the Node `ws` client send a loopback
 * Host and no Origin, so they pass. With a token the guard is absent — the token
 * is the defense there, and LAN hostnames are legitimate.
 */

const PERSONA = {
  name: 'Guard',
  role: 'Guard Tester',
  language: 'en',
  systemPromptOverlay: 'guard',
  avatarEmoji: '🛡️',
  isTemplate: false,
};

async function makeServer(
  authToken?: string
): Promise<{ server: AgentDeckServerInstance; db: AgentDeckDatabase }> {
  const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
  await db.migrate();
  const manager = AgentDeckManager.createWithDatabase(db);
  const server = await createAgentDeckServer({ port: 0, manager, ...(authToken ? { authToken } : {}) });
  await server.ready(); // injectWS never settles on an instance that is not ready
  return { server, db };
}

describe('isLoopbackHost', () => {
  it.each([
    'localhost',
    'LOCALHOST:4321',
    'localhost.',
    '127.0.0.1:4321',
    '127.0.0.2',
    '127.1.2.3:80',
    '[::1]',
    '[::1]:4321',
    '::1',
  ])('accepts %s', (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each([
    '0.0.0.0:4321',
    '192.168.1.5:4321',
    'localhost.evil.com',
    'evil.localhost',
    'localhost:4321.evil',
    '127.0.0.1.evil.com',
    '[::ffff:127.0.0.1]:4321',
    '127.999.0.1',
    '127.0.0.1:123456',
    'attacker.example',
  ])('rejects %s', (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});

describe('local request guard (no token)', () => {
  let server: AgentDeckServerInstance;
  let db: AgentDeckDatabase;
  let home: string;
  let realHome: string | undefined;

  beforeAll(async () => {
    // The secret store writes under ~/.agentdeck; keep the suite off the real HOME.
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-guard-'));
    realHome = process.env['HOME'];
    process.env['HOME'] = home;
    ({ server, db } = await makeServer());
  });

  afterAll(async () => {
    try {
      await server?.close();
      db?.close();
    } finally {
      if (realHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = realHome;
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it('answers a plain local request', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/build-info' });
    expect(res.statusCode).toBe(200);
  });

  it.each(['127.0.0.1:4321', '[::1]:4321', 'LOCALHOST', 'localhost.', '127.0.0.2'])(
    'accepts Host %s',
    async (host) => {
      const res = await server.inject({ method: 'GET', url: '/api/v1/build-info', headers: { host } });
      expect(res.statusCode).toBe(200);
    }
  );

  it.each(['attacker.example', '192.168.1.5:4321', '0.0.0.0:4321', 'localhost.evil.com', 'evil.localhost'])(
    'rejects Host %s (DNS rebinding)',
    async (host) => {
      const res = await server.inject({ method: 'GET', url: '/api/v1/build-info', headers: { host } });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/non-local Host/);
    }
  );

  it('rejects a cross-site POST before the route runs', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/personas',
      headers: { origin: 'https://attacker.example' },
      payload: PERSONA,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/cross-site/);
    const list = await server.inject({ method: 'GET', url: '/api/v1/personas' });
    // Name-based so this does not depend on running before the same-machine POSTs below.
    expect((list.json() as { name: string }[]).some((p) => p.name === PERSONA.name)).toBe(false);
  });

  it('rejects a cross-site credential write', async () => {
    const res = await server.inject({
      method: 'PUT',
      url: '/api/v1/secrets/openrouter',
      headers: { origin: 'https://attacker.example' },
      payload: { value: 'not-a-real-credential' },
    });
    expect(res.statusCode).toBe(403);
    const status = await server.inject({ method: 'GET', url: '/api/v1/secrets/status' });
    expect(status.json().credentialPresence.openrouter).toBeFalsy();
  });

  it.each(['http://localhost:4321', 'http://127.0.0.1:4321', 'http://localhost:3000', 'http://[::1]:4321'])(
    'accepts a same-machine Origin %s',
    async (origin) => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/personas',
        headers: { origin },
        payload: { ...PERSONA, name: `Guard ${origin}` },
      });
      expect(res.statusCode).toBe(200);
    }
  );

  it('rejects an opaque "null" Origin', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/personas',
      headers: { origin: 'null' },
      payload: PERSONA,
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a cross-site GET as well', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/build-info',
      headers: { origin: 'https://attacker.example' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('still lets CORS answer a local preflight, but not a rebound one', async () => {
    const local = await server.inject({
      method: 'OPTIONS',
      url: '/api/v1/personas',
      headers: { origin: 'http://localhost:4321', 'access-control-request-method': 'POST' },
    });
    expect(local.statusCode).toBe(204);
    const rebound = await server.inject({
      method: 'OPTIONS',
      url: '/api/v1/personas',
      headers: { host: 'attacker.example', origin: 'http://localhost:4321', 'access-control-request-method': 'POST' },
    });
    expect(rebound.statusCode).toBe(403);
  });

  it('guards /health (it reveals webRoot) with or without a query string; the SPA stays reachable when bundled', async () => {
    const health = await server.inject({ method: 'GET', url: '/health', headers: { host: 'attacker.example' } });
    expect(health.statusCode).toBe(403);
    // Fastify routes on the path alone, so a query string must not dodge the guard.
    const rebound = await server.inject({ method: 'GET', url: '/health?x=1', headers: { host: 'attacker.example' } });
    expect(rebound.statusCode).toBe(403);
    const crossSite = await server.inject({
      method: 'GET',
      url: '/health?x=1',
      headers: { host: 'localhost:4321', origin: 'https://attacker.example' },
    });
    expect(crossSite.statusCode).toBe(403);
    const local = await server.inject({ method: 'GET', url: '/health?x=1', headers: { host: 'localhost:4321' } });
    expect(local.statusCode).toBe(200);
    if (server.webRoot) {
      const spa = await server.inject({ method: 'GET', url: '/', headers: { host: 'attacker.example' } });
      expect(spa.statusCode).toBe(200);
    }
  });

  it('lets local (non-browser) WebSocket clients in and keeps cross-site ones out', async () => {
    const plain = await server.injectWS('/ws');
    plain.terminate();
    const local = await server.injectWS('/ws', {
      headers: { host: '127.0.0.1:4321', origin: 'http://127.0.0.1:4321' },
    });
    local.terminate();
    await expect(server.injectWS('/ws', { headers: { origin: 'https://attacker.example' } })).rejects.toThrow(/403/);
    await expect(server.injectWS('/ws', { headers: { host: 'attacker.example' } })).rejects.toThrow(/403/);
  });
});

describe('token mode (guard absent, the token is the defense)', () => {
  const TOKEN = 'guard-test-token-12345';
  let server: AgentDeckServerInstance;
  let db: AgentDeckDatabase;

  beforeAll(async () => {
    ({ server, db } = await makeServer(TOKEN));
  });

  afterAll(async () => {
    await server.close();
    db.close();
  });

  it('serves a LAN Host with a valid bearer and rejects it without one', async () => {
    const ok = await server.inject({
      method: 'GET',
      url: '/api/v1/build-info',
      headers: { host: '192.168.1.5:4321', authorization: `Bearer ${TOKEN}` },
    });
    expect(ok.statusCode).toBe(200);
    const anonymous = await server.inject({
      method: 'GET',
      url: '/api/v1/build-info',
      headers: { host: '192.168.1.5:4321' },
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('accepts a LAN WebSocket that carries ?token=', async () => {
    const ws = await server.injectWS(`/ws?token=${TOKEN}`, { headers: { host: '192.168.1.5:4321' } });
    ws.terminate();
  });
});

describe('createAgentDeckServer host rule', () => {
  it('refuses a non-loopback host without a token and accepts it with one', async () => {
    const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);
    await expect(createAgentDeckServer({ port: 0, manager, host: '0.0.0.0' })).rejects.toThrow(/requires --token/);
    const server = await createAgentDeckServer({
      port: 0,
      manager,
      host: '0.0.0.0',
      authToken: 'guard-test-token-12345',
    });
    await server.close();
    db.close();
  });
});

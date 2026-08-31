import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createAgentDeckServer, type AgentDeckServerInstance } from '../src/index.js';

/**
 * API-shape contract for the Agent Control page.
 *
 * The UI half lives in the browser; this half pins the shapes it reads, and in
 * particular that a credential never crosses the wire.
 */
describe('LLM routing API', () => {
  let server: AgentDeckServerInstance;
  let home: string;
  let realHome: string | undefined;

  beforeAll(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-api-'));
    realHome = process.env['HOME'];
    process.env['HOME'] = home;
    server = await createAgentDeckServer({ port: 0, host: '127.0.0.1' });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    if (realHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = realHome;
    await fs.rm(home, { recursive: true, force: true });
  });

  it('reports no routing before one is chosen', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/llm-routing' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.routing).toBeNull();
    // Presence map must survive redactSecrets, or the UI cannot tell whether a
    // key is set. This is why it is not named `credentials`.
    expect(body.credentialPresence).toEqual({});
  });

  it('round-trips a routing', async () => {
    const routing = {
      primary: { providerId: 'openrouter', model: 'z-ai/glm-5.3-flash' },
      backup: { providerId: 'ollama', model: 'qwen3.5:2b' },
      updatedAt: '2026-08-30T00:00:00.000Z',
    };
    const put = await server.inject({ method: 'PUT', url: '/api/v1/llm-routing', payload: routing });
    expect(put.statusCode).toBe(200);

    const get = await server.inject({ method: 'GET', url: '/api/v1/llm-routing' });
    expect(get.json().routing).toEqual(routing);
  });

  it('rejects a malformed routing rather than storing it', async () => {
    const res = await server.inject({
      method: 'PUT',
      url: '/api/v1/llm-routing',
      payload: { primary: { providerId: 'not-a-provider', model: '' } },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('stores a credential and reports only its presence', async () => {
    const secret = 'sk-or-v1-apitestvalue000000000000';
    const put = await server.inject({
      method: 'PUT',
      url: '/api/v1/secrets/openrouter',
      payload: { value: secret },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().credentialRef).toBe('file:openrouter');
    expect(put.body).not.toContain(secret);

    const status = await server.inject({ method: 'GET', url: '/api/v1/secrets/status' });
    expect(status.json().credentialPresence).toEqual({ openrouter: true });
    expect(status.body).not.toContain(secret);

    // The value must not surface anywhere else either.
    for (const url of ['/api/v1/llm-routing', '/api/v1/agents/llm']) {
      const res = await server.inject({ method: 'GET', url });
      expect(res.body, `${url} leaked the credential`).not.toContain(secret);
    }
  });

  it('describes each agent LLM capability honestly', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/agents/llm' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { agentId: string; backupStrategy?: string; configurable: boolean }[];

    const byId = Object.fromEntries(rows.map((r) => [r.agentId, r]));
    expect(byId['garraia']?.backupStrategy).toBe('native');
    expect(byId['openclaw']?.backupStrategy).toBe('native');
    expect(byId['claude-code']?.backupStrategy).toBe('via-gateway');
    // Hermes has no fallback slot, and the API must not pretend otherwise.
    expect(byId['hermes']?.backupStrategy).toBe('none');
    // A declarative agent with no LLM surface is reported, not omitted.
    expect(rows.some((r) => !r.configurable)).toBe(true);
  });

  it('serves the provider catalog with the requested defaults', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/providers/catalog' });
    const catalog = res.json() as { id: string; defaultModel: string; requiresCredential: boolean }[];
    const byId = Object.fromEntries(catalog.map((c) => [c.id, c]));
    expect(byId['openrouter']?.defaultModel).toBe('z-ai/glm-5.3-flash');
    expect(byId['ollama']?.defaultModel).toBe('qwen3.5:2b');
    expect(byId['ollama']?.requiresCredential).toBe(false);
  });

  it('refuses to apply before a routing exists', async () => {
    const fresh = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-api2-'));
    const prev = process.env['HOME'];
    process.env['HOME'] = fresh;
    try {
      const other = await createAgentDeckServer({ port: 0, host: '127.0.0.1' });
      await other.ready();
      const res = await other.inject({
        method: 'POST',
        url: '/api/v1/llm-routing/apply',
        payload: { dryRun: true },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      await other.close();
    } finally {
      process.env['HOME'] = prev;
      await fs.rm(fresh, { recursive: true, force: true });
    }
  });
});

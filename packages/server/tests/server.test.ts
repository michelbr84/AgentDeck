import { describe, it, expect } from 'vitest';
import { createAgentDeckServer } from '../src/index.js';
import { AgentDeckManager } from '@agentdeck/core';
import { AgentDeckDatabase } from '@agentdeck/database';

describe('@agentdeck/server REST API & WebSocket server test suite', () => {
  it('should create server and respond to health and agents endpoints', async () => {
    const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);

    const server = await createAgentDeckServer({
      port: 0,
      manager,
    });

    const healthRes = await server.inject({
      method: 'GET',
      url: '/health',
    });

    expect(healthRes.statusCode).toBe(200);
    const healthBody = JSON.parse(healthRes.body);
    expect(healthBody.status).toBe('healthy');

    const agentsRes = await server.inject({
      method: 'GET',
      url: '/api/v1/agents',
    });

    expect(agentsRes.statusCode).toBe(200);
    const agents = JSON.parse(agentsRes.body);
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBe(8);

    await server.close();
    db.close();
  });

  it('should enforce authentication token when configured', async () => {
    const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);

    const secretToken = 'sec-test-token-12345';
    const server = await createAgentDeckServer({
      port: 0,
      authToken: secretToken,
      manager,
    });

    const unauthRes = await server.inject({
      method: 'GET',
      url: '/api/v1/agents',
    });
    expect(unauthRes.statusCode).toBe(401);

    const authRes = await server.inject({
      method: 'GET',
      url: '/api/v1/agents',
      headers: {
        authorization: `Bearer ${secretToken}`,
      },
    });
    expect(authRes.statusCode).toBe(200);

    await server.close();
    db.close();
  });

  it('should support full REST CRUD operations and prompt inspection', async () => {
    const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);
    const server = await createAgentDeckServer({ port: 0, manager });

    // 1. Create Persona
    const personaRes = await server.inject({
      method: 'POST',
      url: '/api/v1/personas',
      payload: {
        name: 'Inspector',
        role: 'Prompt Inspector',
        language: 'pt-BR',
        systemPromptOverlay: 'Inspect prompt accurately',
        avatarEmoji: '🔍',
        isTemplate: false,
      },
    });
    expect(personaRes.statusCode).toBe(200);
    const persona = JSON.parse(personaRes.body);
    expect(persona.id).toBeDefined();

    // 2. Create Agent Instance
    const installations = await manager.scanAndSyncInstallations();
    const instanceRes = await server.inject({
      method: 'POST',
      url: '/api/v1/instances',
      payload: {
        installationId: installations[0]!.id,
        personaId: persona.id,
        name: 'InspectorInstance',
      },
    });
    expect(instanceRes.statusCode).toBe(200);
    const instance = JSON.parse(instanceRes.body);

    // 3. Create Room
    const roomRes = await server.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      payload: {
        name: 'inspection-room',
        mode: 'mention',
        memberInstanceIds: [instance.id],
      },
    });
    expect(roomRes.statusCode).toBe(200);
    const room = JSON.parse(roomRes.body);

    // 4. Inspect Prompt
    const inspectRes = await server.inject({
      method: 'POST',
      url: '/api/v1/inspect-prompt',
      payload: {
        instanceId: instance.id,
        triggerMessage: 'Explain architecture with key sk-1234567890abcdef1234567890',
      },
    });
    expect(inspectRes.statusCode).toBe(200);
    const inspectTree = JSON.parse(inspectRes.body);
    expect(inspectTree.layers).toBeDefined();
    expect(inspectTree.finalRawPrompt).not.toContain('sk-1234567890abcdef1234567890');

    // 5. Post Message & Retrieve
    const msgRes = await server.inject({
      method: 'POST',
      url: `/api/v1/rooms/${room.id}/messages`,
      payload: {
        content: 'Testing REST message endpoint',
      },
    });
    expect(msgRes.statusCode).toBe(200);

    const getMsgsRes = await server.inject({
      method: 'GET',
      url: `/api/v1/rooms/${room.id}/messages`,
    });
    expect(getMsgsRes.statusCode).toBe(200);
    const msgs = JSON.parse(getMsgsRes.body);
    expect(msgs.length).toBe(1);

    await server.close();
    db.close();
  });
});

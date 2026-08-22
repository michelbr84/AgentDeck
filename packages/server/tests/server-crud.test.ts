import { describe, it, expect } from 'vitest';
import { createAgentDeckServer } from '../src/index.js';
import { AgentDeckManager } from '@agentdeck/core';
import { AgentDeckDatabase } from '@agentdeck/database';

describe('@agentdeck/server v1.0.4 REST Endpoints Suite', () => {
  it('supports Persona CRUD, Duplicate, and Safe Deletion in REST API', async () => {
    const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);
    const server = await createAgentDeckServer({ port: 0, manager });

    // 1. Create Persona
    const createRes = await server.inject({
      method: 'POST',
      url: '/api/v1/personas',
      payload: {
        name: 'Dev Persona',
        role: 'Full Stack',
        language: 'pt-BR',
        systemPromptOverlay: 'Overlay V1',
        avatarEmoji: '⚡',
      },
    });
    expect(createRes.statusCode).toBe(200);
    const created = JSON.parse(createRes.body);

    // 2. Get Persona by ID
    const getRes = await server.inject({
      method: 'GET',
      url: `/api/v1/personas/${created.id}`,
    });
    expect(getRes.statusCode).toBe(200);
    const fetched = JSON.parse(getRes.body);
    expect(fetched.name).toBe('Dev Persona');

    // 3. Update Persona
    const updateRes = await server.inject({
      method: 'PUT',
      url: `/api/v1/personas/${created.id}`,
      payload: {
        systemPromptOverlay: 'Overlay V2 Updated',
      },
    });
    expect(updateRes.statusCode).toBe(200);
    const updated = JSON.parse(updateRes.body);
    expect(updated.systemPromptOverlay).toBe('Overlay V2 Updated');

    // 4. Duplicate Persona
    const dupRes = await server.inject({
      method: 'POST',
      url: `/api/v1/personas/${created.id}/duplicate`,
      payload: {
        newName: 'Dev Persona (Cloned)',
      },
    });
    expect(dupRes.statusCode).toBe(200);
    const cloned = JSON.parse(dupRes.body);
    expect(cloned.name).toBe('Dev Persona (Cloned)');
    expect(cloned.systemPromptOverlay).toBe('Overlay V2 Updated');

    // 5. Create active AgentInstance referencing created persona
    const installations = await manager.scanAndSyncInstallations();
    const instRes = await server.inject({
      method: 'POST',
      url: '/api/v1/instances',
      payload: {
        installationId: installations[0]!.id,
        personaId: created.id,
        name: 'ActiveDevAgent',
      },
    });
    expect(instRes.statusCode).toBe(200);
    const inst = JSON.parse(instRes.body);

    // 6. Attempt Delete Persona (should return 409 Conflict code PERSONA_IN_USE)
    const delConflictRes = await server.inject({
      method: 'DELETE',
      url: `/api/v1/personas/${created.id}`,
    });
    expect(delConflictRes.statusCode).toBe(409);
    const conflictBody = JSON.parse(delConflictRes.body);
    expect(conflictBody.code).toBe('PERSONA_IN_USE');

    // 7. Delete the referencing agent instance
    const delInstRes = await server.inject({
      method: 'DELETE',
      url: `/api/v1/instances/${inst.id}`,
    });
    expect(delInstRes.statusCode).toBe(200);

    // 8. Delete persona now succeeds
    const delOkRes = await server.inject({
      method: 'DELETE',
      url: `/api/v1/personas/${created.id}`,
    });
    expect(delOkRes.statusCode).toBe(200);

    await server.close();
    db.close();
  });

  it('supports Room default agent and member management via REST', async () => {
    const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);
    const server = await createAgentDeckServer({ port: 0, manager });

    const p = await manager.createPersona({ name: 'P1', role: 'Role', language: 'pt-BR', systemPromptOverlay: '', avatarEmoji: '🤖' });
    const installations = await manager.scanAndSyncInstallations();
    const inst = await manager.createAgentInstance({ installationId: installations[0]!.id, personaId: p.id, name: 'Inst1' });

    // 1. Create Room
    const roomRes = await server.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      payload: {
        name: 'rest-room',
        mode: 'mention',
      },
    });
    const room = JSON.parse(roomRes.body);

    // 2. Add Member to Room
    const addMemRes = await server.inject({
      method: 'POST',
      url: `/api/v1/rooms/${room.id}/members`,
      payload: {
        memberType: 'agent_instance',
        memberId: inst.id,
      },
    });
    expect(addMemRes.statusCode).toBe(200);

    // 3. List Members
    const listMemRes = await server.inject({
      method: 'GET',
      url: `/api/v1/rooms/${room.id}/members`,
    });
    expect(listMemRes.statusCode).toBe(200);
    const members = JSON.parse(listMemRes.body);
    expect(members.length).toBe(1);

    // 4. Set Default Agent
    const setDefRes = await server.inject({
      method: 'POST',
      url: `/api/v1/rooms/${room.id}/default-agent`,
      payload: {
        defaultAgentInstanceId: inst.id,
      },
    });
    expect(setDefRes.statusCode).toBe(200);
    const updatedRoom = JSON.parse(setDefRes.body);
    expect(updatedRoom.defaultAgentInstanceId).toBe(inst.id);

    // 5. Remove Member
    const delMemRes = await server.inject({
      method: 'DELETE',
      url: `/api/v1/rooms/${room.id}/members/${inst.id}`,
    });
    expect(delMemRes.statusCode).toBe(200);

    await server.close();
    db.close();
  });
});

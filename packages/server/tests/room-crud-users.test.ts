import { describe, it, expect } from 'vitest';
import { createAgentDeckServer } from '../src/index.js';
import { AgentDeckManager, ChatService } from '@agentdeck/core';
import { AgentDeckDatabase } from '@agentdeck/database';

async function makeServer() {
  const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
  await db.migrate();
  const manager = AgentDeckManager.createWithDatabase(db);
  const server = await createAgentDeckServer({ port: 0, manager });
  return { db, manager, server };
}

describe('room CRUD completion + local user profiles', () => {
  it('DELETE /rooms/:id removes the room and cascades members and messages', async () => {
    const { db, manager, server } = await makeServer();
    const user = await manager.createOrGetLocalProfile('Owner', '👑');
    const room = await manager.createRoom({ name: 'doomed', mode: 'mention', memberUserIds: [user.id] });
    await manager.postMessage({
      roomId: room.id,
      senderType: 'user',
      senderId: user.id,
      senderDisplayName: 'Owner',
      content: 'soon gone',
    });

    const delRes = await server.inject({ method: 'DELETE', url: `/api/v1/rooms/${room.id}` });
    expect(delRes.statusCode).toBe(200);
    expect(JSON.parse(delRes.body).success).toBe(true);

    const getRes = await server.inject({ method: 'GET', url: `/api/v1/rooms/${room.id}` });
    expect(getRes.statusCode).toBe(404);

    const members = await db.db.selectFrom('room_members').selectAll().where('room_id', '=', room.id).execute();
    const messages = await db.db.selectFrom('messages').selectAll().where('room_id', '=', room.id).execute();
    expect(members).toHaveLength(0);
    expect(messages).toHaveLength(0);

    const delMissing = await server.inject({ method: 'DELETE', url: '/api/v1/rooms/nope' });
    expect(delMissing.statusCode).toBe(404);

    await server.close();
    db.close();
  });

  it('rejects deleting a room with a live orchestration run (409)', async () => {
    const { db, manager, server } = await makeServer();
    const room = await manager.createRoom({ name: 'busy', mode: 'mention' });
    const controller = new AbortController();
    manager.registerRun('run-live', room.id, controller);

    const delRes = await server.inject({ method: 'DELETE', url: `/api/v1/rooms/${room.id}` });
    expect(delRes.statusCode).toBe(409);
    expect(JSON.parse(delRes.body).message ?? JSON.parse(delRes.body).error).toContain('active');

    manager.unregisterRun('run-live');
    const delAgain = await server.inject({ method: 'DELETE', url: `/api/v1/rooms/${room.id}` });
    expect(delAgain.statusCode).toBe(200);

    await server.close();
    db.close();
  });

  it('PUT /rooms/:id persists every limit field (was silently dropped)', async () => {
    const { db, manager, server } = await makeServer();
    const room = await manager.createRoom({ name: 'limited', mode: 'panel' });

    const putRes = await server.inject({
      method: 'PUT',
      url: `/api/v1/rooms/${room.id}`,
      payload: { maxTurnsPerRun: 4, maxRuntimeSec: 120, maxCostUSD: 1.5, turnTimeoutSec: 45 },
    });
    expect(putRes.statusCode).toBe(200);
    const updated = JSON.parse(putRes.body);
    expect(updated.maxTurnsPerRun).toBe(4);
    expect(updated.maxRuntimeSec).toBe(120);
    expect(updated.maxCostUSD).toBe(1.5);
    expect(updated.turnTimeoutSec).toBe(45);

    const roundTrip = await manager.getRoom(room.id);
    expect(roundTrip?.turnTimeoutSec).toBe(45);
    expect(roundTrip?.maxCostUSD).toBe(1.5);

    await server.close();
    db.close();
  });

  it('enforces owner/admin role on room mutations when a requester is known', async () => {
    const { db, manager, server } = await makeServer();
    const owner = await manager.createOrGetLocalProfile('Owner', '👑');
    const guest = await manager.createOrGetLocalProfile('Guest', '🙋');
    const room = await manager.createRoom({ name: 'guarded', mode: 'mention', memberUserIds: [owner.id] });
    await manager.addRoomMember(room.id, 'user', guest.id, 'participant');

    // A participant cannot delete or edit.
    const denied = await server.inject({
      method: 'DELETE',
      url: `/api/v1/rooms/${room.id}`,
      headers: { 'x-agentdeck-user-id': guest.id },
    });
    expect(denied.statusCode).toBe(403);

    const deniedEdit = await server.inject({
      method: 'PUT',
      url: `/api/v1/rooms/${room.id}`,
      payload: { name: 'hijacked' },
      headers: { 'x-agentdeck-user-id': guest.id },
    });
    expect(deniedEdit.statusCode).toBe(403);

    // Legacy callers with no identity keep working (cooperative mode).
    const legacyEdit = await server.inject({
      method: 'PUT',
      url: `/api/v1/rooms/${room.id}`,
      payload: { description: 'still editable without identity' },
    });
    expect(legacyEdit.statusCode).toBe(200);

    // The owner can delete.
    const allowed = await server.inject({
      method: 'DELETE',
      url: `/api/v1/rooms/${room.id}`,
      headers: { 'x-agentdeck-user-id': owner.id },
    });
    expect(allowed.statusCode).toBe(200);

    await server.close();
    db.close();
  });

  it('supports user profile CRUD over REST', async () => {
    const { db, server } = await makeServer();

    const createRes = await server.inject({
      method: 'POST',
      url: '/api/v1/users',
      payload: { displayName: 'Ana', avatar: '🧭' },
    });
    expect(createRes.statusCode).toBe(200);
    const ana = JSON.parse(createRes.body);
    expect(ana.id).toBeDefined();

    const getRes = await server.inject({ method: 'GET', url: `/api/v1/users/${ana.id}` });
    expect(getRes.statusCode).toBe(200);
    expect(JSON.parse(getRes.body).displayName).toBe('Ana');

    const putRes = await server.inject({
      method: 'PUT',
      url: `/api/v1/users/${ana.id}`,
      payload: { displayName: 'Ana Paula', avatar: '🌟' },
    });
    expect(putRes.statusCode).toBe(200);
    expect(JSON.parse(putRes.body).displayName).toBe('Ana Paula');

    const delRes = await server.inject({ method: 'DELETE', url: `/api/v1/users/${ana.id}` });
    expect(delRes.statusCode).toBe(200);
    const gone = await server.inject({ method: 'GET', url: `/api/v1/users/${ana.id}` });
    expect(gone.statusCode).toBe(404);

    await server.close();
    db.close();
  });

  it('records a known profile as room participant when it sends a message', async () => {
    const { db, manager, server } = await makeServer();
    const chatService = new ChatService(manager);
    const sender = await manager.createOrGetLocalProfile('Wanderer', '🚶');
    const room = await manager.createRoom({ name: 'open-room', mode: 'mention' });

    await chatService.send({
      roomId: room.id,
      content: 'hello?',
      senderUserId: sender.id,
      senderDisplayName: 'Wanderer',
    });

    const members = await manager.listRoomMembers(room.id);
    const me = members.find((m) => m.memberType === 'user' && m.memberId === sender.id);
    expect(me).toBeDefined();
    expect(me!.role).toBe('participant');

    // Synthetic legacy ids never become members.
    await chatService.send({
      roomId: room.id,
      content: 'legacy hello',
      senderUserId: 'user-default',
      senderDisplayName: 'User',
    });
    const after = await manager.listRoomMembers(room.id);
    expect(after.some((m) => m.memberId === 'user-default')).toBe(false);

    await server.close();
    db.close();
  });
});

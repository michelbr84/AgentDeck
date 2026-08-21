import { describe, it, expect } from 'vitest';
import { AgentDeckManager } from '../src/agent-deck-manager.js';
import { AgentDeckDatabase } from '@agentdeck/database';

describe('@agentdeck/core AgentDeckManager CRUD & Coordinator', () => {
  it('should create database, scan installations, create personas, instances and rooms', async () => {
    const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);

    // 1. Scan and sync installations
    const installations = await manager.scanAndSyncInstallations();
    expect(installations.length).toBe(8);

    // 2. Create Persona
    const persona = await manager.createPersona({
      name: 'Sentinel Pro',
      role: 'Chief Security Officer',
      language: 'en-US',
      systemPromptOverlay: 'Perform thorough vulnerability assessments.',
      avatarEmoji: '🛡️',
      isTemplate: false,
    });
    expect(persona.id).toBeDefined();
    expect(persona.name).toBe('Sentinel Pro');

    // 3. Update Persona
    await manager.updatePersona(persona.id, { role: 'Principal Security Engineer' });
    const personas = await manager.listPersonas();
    const updated = personas.find((p) => p.id === persona.id);
    expect(updated?.role).toBe('Principal Security Engineer');

    // 4. Create Agent Instance
    const inst = await manager.createAgentInstance({
      installationId: installations[0]!.id,
      personaId: persona.id,
      name: 'SentinelBot',
      permissionTier: 'developer',
    });
    expect(inst.name).toBe('SentinelBot');

    const instances = await manager.listAgentInstances();
    expect(instances.length).toBe(1);
    expect(instances[0]?.persona.name).toBe('Sentinel Pro');

    // 5. User Profiles
    const user = await manager.createOrGetLocalProfile('Michel Developer', '👨‍💻');
    expect(user.displayName).toBe('Michel Developer');

    // 6. Create Room & add members
    const room = await manager.createRoom({
      name: 'war-room',
      description: 'Incident response room',
      mode: 'coordinator',
      memberInstanceIds: [inst.id],
      memberUserIds: [user.id],
    });
    expect(room.name).toBe('war-room');
    expect(room.mode).toBe('coordinator');

    const members = await manager.listRoomMembers(room.id);
    expect(members.length).toBe(2);

    // 7. Post messages
    const msg = await manager.postMessage({
      roomId: room.id,
      senderType: 'user',
      senderId: user.id,
      senderDisplayName: user.displayName,
      content: 'Status report on recent patch.',
    });
    expect(msg.content).toBe('Status report on recent patch.');

    const roomMsgs = await manager.getRoomMessages(room.id);
    expect(roomMsgs.length).toBe(1);

    // 8. Delete Agent Instance
    await manager.deleteAgentInstance(inst.id);
    const afterDelete = await manager.listAgentInstances();
    expect(afterDelete.length).toBe(0);

    db.close();
  });
});

import { describe, it, expect } from 'vitest';
import { AgentDeckDatabase } from '@agentdeck/database';
import { AgentDeckManager } from '../src/agent-deck-manager.js';
import { ChatService } from '../src/chat-service.js';

describe('AgentDeck v1.0.4 Deterministic Routing & Management Suite', () => {
  it('handles 0 agents room by returning no_target trace and actionable feedback message', async () => {
    const db = new AgentDeckDatabase({ dbPath: '', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);
    const chatService = new ChatService(manager);

    const user = await manager.createOrGetLocalProfile('Michel', '🧑');
    const room = await manager.createRoom({
      name: 'empty-dev',
      mode: 'mention',
      memberUserIds: [user.id],
      memberInstanceIds: [],
    });

    const result = await chatService.send({
      roomId: room.id,
      content: 'olá',
      senderUserId: user.id,
      senderDisplayName: 'Michel',
    });

    expect(result.status).toBe('completed');
    expect(result.turnsExecuted).toBe(0);
    expect(result.deliveryTrace?.state).toBe('no_target');
    expect(result.deliveryTrace?.reasonCode).toBe('zero_agents');
    expect(result.deliveryTrace?.feedbackMessage).toContain('no active AI agents');
    expect(result.messages.some((m) => m.content.includes('no active AI agents'))).toBe(true);
  });

  it('routes single agent automatically in Mention mode without needing @mention', async () => {
    const db = new AgentDeckDatabase({ dbPath: '', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);

    const user = await manager.createOrGetLocalProfile('Michel', '🧑');
    const persona = await manager.createPersona({
      name: 'Atlas',
      role: 'Architect',
      language: 'pt-BR',
      systemPromptOverlay: 'You are Atlas.',
      avatarEmoji: '🏛️',
      isTemplate: false,
    });

    const installations = await manager.scanAndSyncInstallations();
    const inst = await manager.createAgentInstance({
      installationId: installations[0]!.id,
      personaId: persona.id,
      name: 'Atlas Single',
    });

    const room = await manager.createRoom({
      name: 'single-agent-room',
      mode: 'mention',
      memberUserIds: [user.id],
      memberInstanceIds: [inst.id],
    });

    const activeMembers = await manager.listAgentInstances();
    const routing = manager.orchestrationEngine.resolveRouting(
      room,
      'olá michel aqui',
      activeMembers.filter((i) => i.id === inst.id)
    );

    expect(routing.shouldExecute).toBe(true);
    expect(routing.targetInstances.length).toBe(1);
    expect(routing.targetInstances[0]?.id).toBe(inst.id);
    expect(routing.trace.reasonCode).toBe('single_agent_auto');
  });

  it('routes to defaultAgentInstanceId in multi-agent room when no @mention is present', async () => {
    const db = new AgentDeckDatabase({ dbPath: '', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);

    const user = await manager.createOrGetLocalProfile('Michel', '🧑');
    const p1 = await manager.createPersona({ name: 'Atlas', role: 'Architect', language: 'pt-BR', systemPromptOverlay: '', avatarEmoji: '🏛️', isTemplate: false });
    const p2 = await manager.createPersona({ name: 'Sentinel', role: 'Security', language: 'pt-BR', systemPromptOverlay: '', avatarEmoji: '🛡️', isTemplate: false });

    const installations = await manager.scanAndSyncInstallations();
    const inst1 = await manager.createAgentInstance({ installationId: installations[0]!.id, personaId: p1.id, name: 'Atlas' });
    const inst2 = await manager.createAgentInstance({ installationId: installations[0]!.id, personaId: p2.id, name: 'Sentinel' });

    const room = await manager.createRoom({
      name: 'multi-with-default',
      mode: 'mention',
      defaultAgentInstanceId: inst2.id,
      memberUserIds: [user.id],
      memberInstanceIds: [inst1.id, inst2.id],
    });

    const all = await manager.listAgentInstances();
    const roomAgents = all.filter((i) => i.id === inst1.id || i.id === inst2.id);

    const routing = manager.orchestrationEngine.resolveRouting(room, 'bom dia time', roomAgents);
    expect(routing.shouldExecute).toBe(true);
    expect(routing.targetInstances.length).toBe(1);
    expect(routing.targetInstances[0]?.id).toBe(inst2.id);
    expect(routing.trace.reasonCode).toBe('room_default_agent');
  });

  it('provides actionable guidance in multi-agent room when no default agent and no @mention', async () => {
    const db = new AgentDeckDatabase({ dbPath: '', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);

    const user = await manager.createOrGetLocalProfile('Michel', '🧑');
    const p1 = await manager.createPersona({ name: 'Atlas', role: 'Architect', language: 'pt-BR', systemPromptOverlay: '', avatarEmoji: '🏛️', isTemplate: false });
    const p2 = await manager.createPersona({ name: 'Sentinel', role: 'Security', language: 'pt-BR', systemPromptOverlay: '', avatarEmoji: '🛡️', isTemplate: false });

    const installations = await manager.scanAndSyncInstallations();
    const inst1 = await manager.createAgentInstance({ installationId: installations[0]!.id, personaId: p1.id, name: 'Atlas' });
    const inst2 = await manager.createAgentInstance({ installationId: installations[0]!.id, personaId: p2.id, name: 'Sentinel' });

    const room = await manager.createRoom({
      name: 'multi-no-default',
      mode: 'mention',
      defaultAgentInstanceId: null,
      memberUserIds: [user.id],
      memberInstanceIds: [inst1.id, inst2.id],
    });

    const all = await manager.listAgentInstances();
    const roomAgents = all.filter((i) => i.id === inst1.id || i.id === inst2.id);

    const routing = manager.orchestrationEngine.resolveRouting(room, 'bom dia time', roomAgents);
    expect(routing.shouldExecute).toBe(false);
    expect(routing.trace.state).toBe('no_target');
    expect(routing.trace.reasonCode).toBe('multiple_agents_no_target');
    expect(routing.systemFeedbackMessage).toContain('Multiple agents are available');
  });

  it('enforces safe persona deletion referential integrity (409 PERSONA_IN_USE)', async () => {
    const db = new AgentDeckDatabase({ dbPath: '', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);

    const persona = await manager.createPersona({
      name: 'Active In-Use Persona',
      role: 'Reviewer',
      language: 'pt-BR',
      systemPromptOverlay: '',
      avatarEmoji: '⚡',
      isTemplate: false,
    });

    const installations = await manager.scanAndSyncInstallations();
    const inst = await manager.createAgentInstance({
      installationId: installations[0]!.id,
      personaId: persona.id,
      name: 'Instance Using Persona',
    });

    // Attempting to delete persona while active instance uses it should throw 409
    await expect(manager.deletePersona(persona.id)).rejects.toThrow(/in use by active agent instance/);

    // Disable or delete the instance
    await manager.deleteAgentInstance(inst.id);

    // Now deletion of persona succeeds
    await expect(manager.deletePersona(persona.id)).resolves.not.toThrow();
  });

  it('supports duplicating and updating personas with non-destructive system prompt overlay', async () => {
    const db = new AgentDeckDatabase({ dbPath: '', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);

    const original = await manager.createPersona({
      name: 'Base Architect',
      role: 'Architect',
      language: 'pt-BR',
      systemPromptOverlay: 'Base prompt',
      avatarEmoji: '🏛️',
      isTemplate: false,
    });

    const copy = await manager.duplicatePersona(original.id, 'Architect V2');
    expect(copy.name).toBe('Architect V2');
    expect(copy.role).toBe(original.role);
    expect(copy.systemPromptOverlay).toBe(original.systemPromptOverlay);

    await manager.updatePersona(copy.id, {
      systemPromptOverlay: 'Updated non-destructive prompt overlay',
    });

    const updated = await manager.getPersona(copy.id);
    expect(updated?.systemPromptOverlay).toBe('Updated non-destructive prompt overlay');
  });
});

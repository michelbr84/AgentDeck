import { describe, it, expect } from 'vitest';
import { AgentDeckManager, MultiAgentOrchestrationEngine } from '../src/index.js';
import { AgentDeckDatabase } from '@agentdeck/database';

describe('@agentdeck/core MultiAgentOrchestrationEngine', () => {
  it('should execute Mention mode and only invoke mentioned agents', async () => {
    const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);
    const engine = new MultiAgentOrchestrationEngine(manager);

    const installations = await manager.scanAndSyncInstallations();
    const claudeInst = installations.find((i) => i.definitionId === 'claude-code')!;
    const hermesInst = installations.find((i) => i.definitionId === 'hermes')!;

    const persona1 = await manager.createPersona({
      name: 'Atlas',
      role: 'Architect',
      language: 'pt-BR',
      systemPromptOverlay: 'Design systems',
      avatarEmoji: '🏛️',
      isTemplate: false,
    });

    const persona2 = await manager.createPersona({
      name: 'Sentinel',
      role: 'Security',
      language: 'en-US',
      systemPromptOverlay: 'Audit security',
      avatarEmoji: '🛡️',
      isTemplate: false,
    });

    const inst1 = await manager.createAgentInstance({
      installationId: claudeInst.id,
      personaId: persona1.id,
      name: 'AtlasClaude',
    });

    const inst2 = await manager.createAgentInstance({
      installationId: hermesInst.id,
      personaId: persona2.id,
      name: 'SentinelHermes',
    });

    const user = await manager.createOrGetLocalProfile('Michel', '👨‍💻');
    const room = await manager.createRoom({
      name: 'design-room',
      mode: 'mention',
      memberInstanceIds: [inst1.id, inst2.id],
      memberUserIds: [user.id],
    });

    const result = await engine.executeRun({
      roomId: room.id,
      triggerMessage: 'Hello @AtlasClaude please analyze the DB architecture',
      senderUserId: user.id,
      senderDisplayName: 'Michel',
    });

    expect(result.status).toBe('completed');
    expect(result.turnsExecuted).toBe(1);
    expect(result.messages.length).toBe(2); // 1 user + 1 agent
    expect(result.messages[1]!.senderDisplayName).toContain('AtlasClaude');

    db.close();
  });

  it('should execute Panel / Broadcast mode across all agents with multiline prompts', async () => {
    const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);
    const engine = new MultiAgentOrchestrationEngine(manager);

    const installations = await manager.scanAndSyncInstallations();
    const persona = await manager.createPersona({
      name: 'Reviewer',
      role: 'Code Reviewer',
      language: 'pt-BR',
      systemPromptOverlay: 'Review code strictly and suggest improvements',
      avatarEmoji: '🔍',
      isTemplate: false,
    });

    const inst1 = await manager.createAgentInstance({
      installationId: installations[0]!.id,
      personaId: persona.id,
      name: 'Reviewer1',
    });

    const inst2 = await manager.createAgentInstance({
      installationId: installations[1]!.id,
      personaId: persona.id,
      name: 'Reviewer2',
    });

    const user = await manager.createOrGetLocalProfile('Michel', '👨‍💻');
    const room = await manager.createRoom({
      name: 'panel-room',
      mode: 'panel',
      memberInstanceIds: [inst1.id, inst2.id],
      memberUserIds: [user.id],
    });

    const complexMultilineTrigger = `### Panel Code Review Request
Please evaluate the following snippet:
\`\`\`bash
find . -name "*.log" | xargs rm -f; echo "Cleaned"
\`\`\`
Questions:
1. Is this safe for filenames with spaces?
2. What alternative command is recommended?`;

    const result = await engine.executeRun({
      roomId: room.id,
      triggerMessage: complexMultilineTrigger,
      senderUserId: user.id,
      senderDisplayName: 'Michel',
    });

    expect(result.status).toBe('completed');
    expect(result.turnsExecuted).toBe(2);
    expect(result.messages.length).toBe(3); // 1 user + 2 agents
    expect(result.messages[1]!.content).toBeDefined();
    expect(result.messages[2]!.content).toBeDefined();

    db.close();
  });

  it('should sanitize error output when agent adapter fails without leaking prompt trees', async () => {
    const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);
    const engine = new MultiAgentOrchestrationEngine(manager);

    const installations = await manager.scanAndSyncInstallations();
    const mockInst = installations[0]!;

    const persona = await manager.createPersona({
      name: 'FailingAgent',
      role: 'Tester',
      language: 'en-US',
      systemPromptOverlay: 'SUPER_SECRET_INTERNAL_SYSTEM_PROMPT_LAYER_THAT_SHOULD_NOT_LEAK',
      avatarEmoji: '💥',
      isTemplate: false,
    });

    const inst = await manager.createAgentInstance({
      installationId: mockInst.id,
      personaId: persona.id,
      name: 'FailInst',
    });

    // Temporarily mock adapter to throw an error with secret content
    const adapter = manager.getAdapter(mockInst.definitionId)!;
    const origExecute = adapter.execute.bind(adapter);
    adapter.execute = async () => {
      throw new Error('Command failed: ENOENT binary not found\nPrompt: SUPER_SECRET_INTERNAL_SYSTEM_PROMPT_LAYER_THAT_SHOULD_NOT_LEAK');
    };

    const user = await manager.createOrGetLocalProfile('Michel', '👨‍💻');
    const room = await manager.createRoom({
      name: 'fail-room',
      mode: 'mention',
      memberInstanceIds: [inst.id],
      memberUserIds: [user.id],
    });

    const result = await engine.executeRun({
      roomId: room.id,
      triggerMessage: '@FailInst hello test error',
      senderUserId: user.id,
      senderDisplayName: 'Michel',
    });

    expect(result.messages.length).toBe(2);
    const errorMessage = result.messages[1]!.content;
    expect(errorMessage).toContain('⚠️ Agent execution failed');
    expect(errorMessage).toContain('Reason: Agent binary or executable was not found.');
    expect(errorMessage).not.toContain('SUPER_SECRET_INTERNAL_SYSTEM_PROMPT_LAYER_THAT_SHOULD_NOT_LEAK');

    adapter.execute = origExecute;
    db.close();
  });

  it('should respect abortSignal for immediate pause / cancellation', async () => {
    const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);
    const engine = new MultiAgentOrchestrationEngine(manager);

    const installations = await manager.scanAndSyncInstallations();
    const persona = await manager.createPersona({
      name: 'Debater',
      role: 'Debater',
      language: 'pt-BR',
      systemPromptOverlay: 'Debate vigorously',
      avatarEmoji: '⚡',
      isTemplate: false,
    });

    const inst = await manager.createAgentInstance({
      installationId: installations[0]!.id,
      personaId: persona.id,
      name: 'Debater1',
    });

    const user = await manager.createOrGetLocalProfile('Michel', '👨‍💻');
    const room = await manager.createRoom({
      name: 'debate-room',
      mode: 'debate',
      memberInstanceIds: [inst.id],
      memberUserIds: [user.id],
    });

    const abortCtrl = new AbortController();
    abortCtrl.abort(); // Pre-aborted

    const result = await engine.executeRun({
      roomId: room.id,
      triggerMessage: 'Begin debate',
      senderUserId: user.id,
      senderDisplayName: 'Michel',
      abortSignal: abortCtrl.signal,
    });

    expect(result.status).toBe('cancelled');
    expect(result.turnsExecuted).toBe(0);

    db.close();
  });

  it('should execute Coordinator / Moderator mode', async () => {
    const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);
    const engine = new MultiAgentOrchestrationEngine(manager);

    const installations = await manager.scanAndSyncInstallations();
    const persona = await manager.createPersona({
      name: 'Coordinator',
      role: 'Lead Coordinator',
      language: 'pt-BR',
      systemPromptOverlay: 'Coordinate tasks among specialists',
      avatarEmoji: '🎯',
      isTemplate: false,
    });

    const inst = await manager.createAgentInstance({
      installationId: installations[0]!.id,
      personaId: persona.id,
      name: 'LeadCoordinator',
    });

    const user = await manager.createOrGetLocalProfile('Michel', '👨‍💻');
    const room = await manager.createRoom({
      name: 'coordinator-room',
      mode: 'coordinator',
      memberInstanceIds: [inst.id],
      memberUserIds: [user.id],
    });

    const result = await engine.executeRun({
      roomId: room.id,
      triggerMessage: 'Organize team to deploy update',
      senderUserId: user.id,
      senderDisplayName: 'Michel',
    });

    expect(result.status).toBe('completed');
    expect(result.turnsExecuted).toBe(1);
    expect(result.messages.length).toBe(2);

    db.close();
  });
});

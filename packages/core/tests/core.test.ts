import { describe, it, expect } from 'vitest';
import {
  EventBus,
  PromptComposer,
  TransactionalUpgradeEngine,
  AgentDeckManager,
  DeclarativePluginAdapter,
} from '../src/index.js';
import { ClaudeCodeAdapter } from '@agentdeck/adapters';
import { AgentDeckDatabase } from '@agentdeck/database';

describe('@agentdeck/core engine test suite', () => {
  it('EventBus should emit and listen with correlation envelopes', () => {
    const bus = new EventBus();
    const received: unknown[] = [];

    bus.on('test:event', (envelope) => {
      received.push(envelope);
    });

    const envelope = bus.emit('test:event', { foo: 'bar' }, { correlationId: 'test-123' });
    expect(envelope.correlationId).toBe('test-123');
    expect(received.length).toBe(1);
  });

  it('PromptComposer should layer prompt with provenance and token estimation', () => {
    const composer = new PromptComposer();
    const persona = {
      id: 'persona-1',
      name: 'Atlas',
      role: 'Senior Architect',
      language: 'pt-BR',
      systemPromptOverlay: 'Ensure clean architecture.',
      avatarEmoji: '🏛️',
      isTemplate: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const tree = composer.compose({
      instanceId: 'inst-1',
      persona,
      globalPolicy: 'Be precise and concise.',
      workspaceContext: '/workspace/project',
      roomInstructions: 'Round-robin discussion',
      triggerMessage: 'Design the database model.',
    });

    expect(tree.layers.length).toBe(6);
    expect(tree.finalRawPrompt).toContain('Atlas');
    expect(tree.finalRawPrompt).toContain('pt-BR');
    expect(tree.totalEstimatedTokens.value).toBeGreaterThan(0);
  });

  it('TransactionalUpgradeEngine should create safe dry-run plan without mutations', async () => {
    const bus = new EventBus();
    const engine = new TransactionalUpgradeEngine(bus);
    const adapter = new ClaudeCodeAdapter();

    const plan = await engine.createPlan(adapter);
    expect(plan.definitionId).toBe('claude-code');
    expect(plan.targetVersion).toBeDefined();

    const result = await engine.executeUpgrade(adapter, { dryRun: true });
    expect(result.success).toBe(true);
    expect(result.rolledBack).toBe(false);
  });

  it('PluginLoader and DeclarativePluginAdapter should parse and wrap simple manifests', async () => {
    const adapter = new DeclarativePluginAdapter({
      apiVersion: 'agentdeck.io/v1alpha1',
      kind: 'AgentPlugin',
      category: 'coding',
      id: 'custom-cli',
      name: 'Custom CLI Assistant',
      version: '1.2.0',
      description: 'Custom test assistant',
      detect: { which: 'custom-cli-bin', standardPaths: [] },
      versionCheck: { command: 'custom-cli-bin', args: ['-v'], regex: '([0-9]+\\.[0-9]+)' },
      execution: { command: 'custom-cli-bin', args: ['--prompt', '{{prompt}}'] },
      capabilities: { chat: true },
    });

    expect(adapter.definition.id).toBe('custom-cli');
    expect(adapter.capabilities.chat).toBe(true);
    const det = await adapter.detect();
    expect(det.installed).toBe(false);
  });

  it('AgentDeckManager should manage installations, personas, people, and rooms', async () => {
    const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);

    const installations = await manager.scanAndSyncInstallations();
    // 8 built-in adapters (Claude Code, Hermes, OpenClaw, GarraIA, Pi, Kilo, Cline, Codex)
    expect(installations.length).toBe(8);

    const persona = await manager.createPersona({
      name: 'Sentinel Pro',
      role: 'Security Analyst',
      language: 'pt-BR',
      systemPromptOverlay: 'Check all vulnerabilities',
      avatarEmoji: '🛡️',
      isTemplate: false,
    });
    expect(persona.id).toBeDefined();

    const instance = await manager.createAgentInstance({
      installationId: installations[0]!.id,
      personaId: persona.id,
      name: 'Sentinel Claude',
    });
    expect(instance.name).toBe('Sentinel Claude');

    // Test LocalProfile human creation
    const user = await manager.createOrGetLocalProfile('Michel', '👨‍💻');
    expect(user.displayName).toBe('Michel');

    const room = await manager.createRoom({
      name: 'architecture-room',
      mode: 'debate',
      memberInstanceIds: [instance.id],
      memberUserIds: [user.id],
    });
    expect(room.name).toBe('architecture-room');

    const members = await manager.listRoomMembers(room.id);
    expect(members.length).toBe(2);

    const msg = await manager.postMessage({
      roomId: room.id,
      senderType: 'user',
      senderId: user.id,
      senderDisplayName: 'Michel',
      content: 'Let us design the high performance pipeline',
    });
    expect(msg.content).toContain('pipeline');

    const roomMsgs = await manager.getRoomMessages(room.id);
    expect(roomMsgs.length).toBe(1);

    db.close();
  });
});

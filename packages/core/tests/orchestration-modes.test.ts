import { describe, it, expect } from 'vitest';
import { AgentDeckManager, MultiAgentOrchestrationEngine } from '../src/index.js';
import { AgentDeckDatabase } from '@agentdeck/database';
import type { AgentAdapter, ExecutionContext, ExecutionResult } from '@agentdeck/adapter-sdk';

const INSTALL_STATE = {
  availability: 'available',
  installation: 'installed',
  configuration: 'configured',
  authentication: 'authenticated',
  health: 'healthy',
  version: 'current',
  runtime: 'stopped',
};

function okResult(content: string): ExecutionResult {
  return {
    content,
    exitCode: 0,
    transport: 'mock',
    tokensUsed: {
      input: { source: 'estimated', value: 1 },
      output: { source: 'estimated', value: 1 },
      total: { source: 'estimated', value: 2 },
    },
    costUSD: { source: 'estimated', value: 0 },
  };
}

function makeAdapter(id: string, execute: (ctx: ExecutionContext) => Promise<ExecutionResult>): AgentAdapter {
  return {
    definition: {
      id,
      name: id,
      description: 'test-only adapter',
      version: '1.0.0',
      capabilities: {},
      rollbackCapabilities: { config: false, binary: false },
      supportedPlatforms: ['linux'],
      supportedArchitectures: ['x64'],
    },
    capabilities: {},
    rollbackCapabilities: { config: false, binary: false },
    detect: async () => ({ installed: true, binaryPath: '/bin/true', version: '1.0.0', state: INSTALL_STATE }),
    getLatestVersion: async () => ({ latestVersion: '1.0.0' }),
    execute,
  } as unknown as AgentAdapter;
}

async function makeManager(adapters: AgentAdapter[]) {
  const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
  await db.migrate();
  const manager = AgentDeckManager.createWithDatabase(db);
  for (const a of adapters) manager.registerAdapter(a);
  const engine = new MultiAgentOrchestrationEngine(manager);
  const installations = await manager.scanAndSyncInstallations();
  const persona = await manager.createPersona({
    name: 'ModeTester',
    role: 'Mode Tester',
    language: 'en-US',
    systemPromptOverlay: 'test the modes',
    avatarEmoji: '🧪',
    isTemplate: false,
  });
  return { db, manager, engine, installations, persona };
}

describe('orchestration modes — concurrency and structured phases', () => {
  it('panel mode executes members CONCURRENTLY with stable pre-assigned turn indexes', async () => {
    const spans: Record<string, { start: number; end: number }> = {};
    const timed = (id: string) =>
      makeAdapter(id, async () => {
        const start = Date.now();
        await new Promise((r) => setTimeout(r, 250));
        spans[id] = { start, end: Date.now() };
        return okResult(`${id} answer`);
      });

    const { db, manager, engine, installations, persona } = await makeManager([timed('panel-a'), timed('panel-b')]);
    const instA = await manager.createAgentInstance({
      installationId: installations.find((i) => i.definitionId === 'panel-a')!.id,
      personaId: persona.id,
      name: 'PanelA',
    });
    const instB = await manager.createAgentInstance({
      installationId: installations.find((i) => i.definitionId === 'panel-b')!.id,
      personaId: persona.id,
      name: 'PanelB',
    });
    const room = await manager.createRoom({
      name: 'overlap-room',
      mode: 'panel',
      memberInstanceIds: [instA.id, instB.id],
    });

    const result = await engine.executeRun({
      roomId: room.id,
      triggerMessage: 'answer in parallel',
      senderUserId: 'u',
      senderDisplayName: 'U',
    });

    expect(result.status).toBe('completed');
    expect(result.turnsExecuted).toBe(2);
    // Both adapters must have been in flight at the same time.
    const overlap =
      Math.max(spans['panel-a']!.start, spans['panel-b']!.start) <
      Math.min(spans['panel-a']!.end, spans['panel-b']!.end);
    expect(overlap).toBe(true);

    // Pre-assigned indexes persisted per member, regardless of completion order.
    const agentMessages = await manager.getRoomMessages(room.id, 10);
    const byName = new Map(
      agentMessages.filter((m) => m.senderType === 'agent_instance').map((m) => [m.content, m.turnIndex])
    );
    expect(new Set(byName.values())).toEqual(new Set([1, 2]));

    db.close();
  }, 15_000);

  it('coordinator mode runs plan → delegate → synthesis across members', async () => {
    const seenDirectives: string[] = [];
    const echo = (id: string) =>
      makeAdapter(id, async (ctx) => {
        const directiveLayer = ctx.promptTree.layers.find((l) => l.layerName === 'Turn Directive');
        seenDirectives.push(directiveLayer?.content ?? '');
        return okResult(`${id} contribution`);
      });

    const { db, manager, engine, installations, persona } = await makeManager([
      echo('coord-lead'),
      echo('coord-spec'),
    ]);
    const lead = await manager.createAgentInstance({
      installationId: installations.find((i) => i.definitionId === 'coord-lead')!.id,
      personaId: persona.id,
      name: 'LeadBot',
    });
    const spec = await manager.createAgentInstance({
      installationId: installations.find((i) => i.definitionId === 'coord-spec')!.id,
      personaId: persona.id,
      name: 'SpecialistBot',
    });
    const room = await manager.createRoom({
      name: 'coord-room',
      mode: 'coordinator',
      defaultAgentInstanceId: lead.id,
      memberInstanceIds: [lead.id, spec.id],
    });

    const result = await engine.executeRun({
      roomId: room.id,
      triggerMessage: 'Ship the release',
      senderUserId: 'u',
      senderDisplayName: 'U',
    });

    expect(result.status).toBe('completed');
    // Mock plan text parses to a single fallback subtask: plan + 1 delegate + synthesis.
    expect(result.turnsExecuted).toBe(3);
    const phases = result.messages
      .map((m) => (m.rawPayload as { coordinatorPhase?: string } | undefined)?.coordinatorPhase)
      .filter(Boolean);
    expect(phases).toEqual(['plan', 'delegate', 'synthesis']);
    // Delegation went to the specialist, not back to the lead.
    const delegateMsg = result.messages.find(
      (m) => (m.rawPayload as { coordinatorPhase?: string } | undefined)?.coordinatorPhase === 'delegate'
    );
    expect(delegateMsg!.senderDisplayName).toContain('SpecialistBot');
    expect(seenDirectives.filter((d) => d.includes('PLAN')).length).toBe(1);
    expect(seenDirectives.filter((d) => d.includes('DELEGATE')).length).toBe(1);
    expect(seenDirectives.filter((d) => d.includes('SYNTHESIS')).length).toBe(1);

    db.close();
  }, 15_000);

  it('coordinator parses a fenced JSON plan and matches named specialists', async () => {
    const plannedJson = [
      'Here is my plan:',
      '```json',
      JSON.stringify({
        subtasks: [
          { task: 'Design the schema', specialist: 'DataBot' },
          { task: 'Write the docs', specialist: 'DocsBot' },
        ],
      }),
      '```',
    ].join('\n');

    const lead = makeAdapter('json-lead', async (ctx) => {
      const directiveLayer = ctx.promptTree.layers.find((l) => l.layerName === 'Turn Directive');
      return okResult(directiveLayer?.content.includes('PLAN') ? plannedJson : 'final synthesis');
    });
    const specExec = (id: string) =>
      makeAdapter(id, async (ctx) => okResult(`${id} did: ${ctx.promptTree.layers.at(-1)?.content ?? ''}`));

    const { db, manager, engine, installations, persona } = await makeManager([
      lead,
      specExec('spec-data'),
      specExec('spec-docs'),
    ]);
    const leadInst = await manager.createAgentInstance({
      installationId: installations.find((i) => i.definitionId === 'json-lead')!.id,
      personaId: persona.id,
      name: 'PlannerBot',
    });
    const dataInst = await manager.createAgentInstance({
      installationId: installations.find((i) => i.definitionId === 'spec-data')!.id,
      personaId: persona.id,
      name: 'DataBot',
    });
    const docsInst = await manager.createAgentInstance({
      installationId: installations.find((i) => i.definitionId === 'spec-docs')!.id,
      personaId: persona.id,
      name: 'DocsBot',
    });
    const room = await manager.createRoom({
      name: 'json-coord-room',
      mode: 'coordinator',
      defaultAgentInstanceId: leadInst.id,
      memberInstanceIds: [leadInst.id, dataInst.id, docsInst.id],
    });

    const result = await engine.executeRun({
      roomId: room.id,
      triggerMessage: 'Build the feature',
      senderUserId: 'u',
      senderDisplayName: 'U',
    });

    // plan + 2 delegates + synthesis
    expect(result.turnsExecuted).toBe(4);
    const delegates = result.messages.filter(
      (m) => (m.rawPayload as { coordinatorPhase?: string } | undefined)?.coordinatorPhase === 'delegate'
    );
    expect(delegates.length).toBe(2);
    const senders = delegates.map((m) => m.senderDisplayName).join(' ');
    expect(senders).toContain('DataBot');
    expect(senders).toContain('DocsBot');

    db.close();
  }, 15_000);

  it('round_robin keeps its original alternating behavior', async () => {
    const { db, manager, engine, installations, persona } = await makeManager([]);
    const inst1 = await manager.createAgentInstance({
      installationId: installations[0]!.id,
      personaId: persona.id,
      name: 'RR1',
    });
    const inst2 = await manager.createAgentInstance({
      installationId: installations[1]!.id,
      personaId: persona.id,
      name: 'RR2',
    });
    const room = await manager.createRoom({
      name: 'rr-room',
      mode: 'round_robin',
      memberInstanceIds: [inst1.id, inst2.id],
    });

    const result = await engine.executeRun({
      roomId: room.id,
      triggerMessage: 'go around',
      senderUserId: 'u',
      senderDisplayName: 'U',
    });

    // Unchanged legacy formula: min(maxTurns, members * 2) = 4 turns.
    expect(result.status).toBe('completed');
    expect(result.turnsExecuted).toBe(4);
    // No debate roles leak into round_robin messages.
    expect(
      result.messages.some((m) => (m.rawPayload as { debateRole?: string } | undefined)?.debateRole)
    ).toBe(false);

    db.close();
  }, 15_000);
});

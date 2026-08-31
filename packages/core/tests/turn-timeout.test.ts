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

/** Built-ins short-circuit to instant mocks under NODE_ENV=test, so timeout
 * behavior needs a custom adapter registered through the public registry. */
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

function slowExecute(delayMs: number, content = 'slow response') {
  return (ctx: ExecutionContext): Promise<ExecutionResult> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(okResult(content)), delayMs);
      ctx.abortSignal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject((ctx.abortSignal.reason as Error) ?? new Error('aborted'));
        },
        { once: true }
      );
    });
}

async function makeFixture(adapters: AgentAdapter[], roomOpts: { mode: 'mention' | 'panel'; turnTimeoutSec?: number }) {
  const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
  await db.migrate();
  const manager = AgentDeckManager.createWithDatabase(db);
  for (const a of adapters) manager.registerAdapter(a);
  const engine = new MultiAgentOrchestrationEngine(manager);

  const installations = await manager.scanAndSyncInstallations();
  const persona = await manager.createPersona({
    name: 'Timer',
    role: 'Timing Agent',
    language: 'en-US',
    systemPromptOverlay: 'respect the clock',
    avatarEmoji: '⏱️',
    isTemplate: false,
  });

  const instanceIds: string[] = [];
  for (const a of adapters) {
    const install = installations.find((i) => i.definitionId === a.definition.id)!;
    const inst = await manager.createAgentInstance({
      installationId: install.id,
      personaId: persona.id,
      name: `${a.definition.id}-bot`,
    });
    instanceIds.push(inst.id);
  }

  const room = await manager.createRoom({
    name: 'timeout-room',
    mode: roomOpts.mode,
    memberInstanceIds: instanceIds,
    turnTimeoutSec: roomOpts.turnTimeoutSec,
  });
  return { db, manager, engine, room };
}

describe('per-turn timeout & run abort semantics', () => {
  it('a timed-out turn posts a timeout fallback and the run continues', async () => {
    const slow = makeAdapter('slow-agent', slowExecute(8000));
    const fast = makeAdapter('fast-agent', async () => okResult('fast response'));
    const { db, engine, room } = await makeFixture([slow, fast], { mode: 'panel' });

    const startedAt = Date.now();
    const result = await engine.executeRun({
      roomId: room.id,
      triggerMessage: 'go @all',
      senderUserId: 'user-t',
      senderDisplayName: 'Tester',
      turnTimeoutMs: 600,
    });

    expect(result.status).toBe('completed');
    expect(result.turnsExecuted).toBe(2);
    const contents = result.messages.map((m) => m.content);
    expect(contents.some((c) => c.includes('timeout'))).toBe(true);
    expect(contents.some((c) => c === 'fast response')).toBe(true);
    // Wall clock must reflect the 600ms cap, not the adapter's 8s sleep.
    expect(Date.now() - startedAt).toBeLessThan(6000);

    db.close();
  }, 15_000);

  it('room.turnTimeoutSec drives the effective per-turn timeout', async () => {
    const slow = makeAdapter('slow-agent', slowExecute(8000));
    const { db, engine, room } = await makeFixture([slow], { mode: 'mention', turnTimeoutSec: 1 });
    expect(room.turnTimeoutSec).toBe(1);

    const startedAt = Date.now();
    const result = await engine.executeRun({
      roomId: room.id,
      triggerMessage: 'take your time',
      senderUserId: 'user-t',
      senderDisplayName: 'Tester',
    });

    expect(result.status).toBe('completed');
    expect(result.messages.some((m) => m.content.includes('1s timeout'))).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(6000);

    db.close();
  }, 15_000);

  it('a caller abort cancels the run without posting an error into the room', async () => {
    const slow = makeAdapter('slow-agent', slowExecute(8000));
    const { db, manager, engine, room } = await makeFixture([slow], { mode: 'mention' });

    const controller = new AbortController();
    const runPromise = engine.executeRun({
      roomId: room.id,
      triggerMessage: 'work forever',
      senderUserId: 'user-t',
      senderDisplayName: 'Tester',
      abortSignal: controller.signal,
    });
    setTimeout(() => controller.abort(), 200);

    const result = await runPromise;
    expect(result.status).toBe('cancelled');
    expect(result.deliveryTrace?.state).toBe('cancelled');
    expect(result.deliveryTrace?.reasonCode).toBe('run_aborted');
    expect(result.messages.some((m) => m.content.includes('Agent execution failed'))).toBe(false);

    const persisted = await manager.getRoomMessages(room.id, 50);
    expect(persisted.some((m) => m.content.includes('Agent execution failed'))).toBe(false);

    db.close();
  }, 15_000);

  it('manager.abortRoomRuns stops a live run through the registry', async () => {
    const slow = makeAdapter('slow-agent', slowExecute(8000));
    const { db, manager, engine, room } = await makeFixture([slow], { mode: 'mention' });

    const runPromise = engine.executeRun({
      roomId: room.id,
      triggerMessage: 'work forever',
      senderUserId: 'user-t',
      senderDisplayName: 'Tester',
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(manager.hasActiveRunForRoom(room.id)).toBe(true);
    expect(manager.abortRoomRuns(room.id)).toBe(1);

    const result = await runPromise;
    expect(result.status).toBe('cancelled');
    expect(manager.hasActiveRunForRoom(room.id)).toBe(false);

    db.close();
  }, 15_000);
});

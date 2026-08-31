import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAgentDeckServer } from '../src/index.js';
import { AgentDeckManager, MultiAgentOrchestrationEngine, PromptComposer } from '@agentdeck/core';
import { AgentDeckDatabase } from '@agentdeck/database';
import { redactSecrets } from '@agentdeck/security';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';

describe('AgentDeck Full Runtime & E2E Acceptance Suite', () => {
  let db: AgentDeckDatabase;
  let manager: AgentDeckManager;
  let engine: MultiAgentOrchestrationEngine;
  let composer: PromptComposer;
  let server: FastifyInstance;
  const TEST_PORT = 4323;
  const TEST_TOKEN = 'test-sec-auth-token-999';

  beforeAll(async () => {
    db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    manager = AgentDeckManager.createWithDatabase(db);
    engine = new MultiAgentOrchestrationEngine(manager);
    composer = new PromptComposer();

    // Start Fastify server listening on real 127.0.0.1:4321
    server = await createAgentDeckServer({
      port: TEST_PORT,
      host: '127.0.0.1',
      authToken: TEST_TOKEN,
      manager,
    });
    await server.listen({ port: TEST_PORT, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await server.close();
    db.close();
  });

  // 1. SQLite Pragmas & Integrity Checks
  it('1. SQLite Runtime Verification (Pragmas, integrity & foreign keys)', async () => {
    const check = await db.integrityCheck();
    expect(check.ok).toBe(true);

    const fkResult = await db.raw<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(fkResult[0]?.foreign_keys).toBe(1);

    const jmResult = await db.raw<{ journal_mode: string }>('PRAGMA journal_mode');
    expect(['wal', 'memory']).toContain(jmResult[0]?.journal_mode);
  });

  // 2. Fastify REST Endpoints Smoke Test (Auth, Health, AgentDeck API)
  it('2. Fastify REST Smoke & Security (401 without token, 200 with token, endpoints test)', async () => {
    // Health is public
    const healthRes = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
    expect(healthRes.status).toBe(200);
    const healthJson = await healthRes.json();
    expect(healthJson.status).toBe('healthy');

    // API without token -> 401 Unauthorized
    const unauthRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/agents`);
    expect(unauthRes.status).toBe(401);

    // API with token -> 200 OK
    const authHeaders = {
      Authorization: `Bearer ${TEST_TOKEN}`,
      'Content-Type': 'application/json',
    };

    const agentsRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/agents`, { headers: authHeaders });
    expect(agentsRes.status).toBe(200);
    const agents = await agentsRes.json();
    expect(agents.length).toBe(8);

    // Create Persona
    const personaRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/personas`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'E2E Architect',
        role: 'Systems Architect',
        language: 'pt-BR',
        systemPromptOverlay: 'Architecture and security focus',
        avatarEmoji: '🏛️',
        isTemplate: false,
      }),
    });
    expect(personaRes.status).toBe(200);
    const persona = await personaRes.json();
    expect(persona.id).toBeDefined();

    // Create Agent Instance
    const instRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/instances`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        installationId: agents[0].id,
        personaId: persona.id,
        name: 'LiveClaudeArchitect',
      }),
    });
    expect(instRes.status).toBe(200);
    const instance = await instRes.json();
    expect(instance.id).toBeDefined();

    // Create User Profile
    const userRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/users`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        displayName: 'Michel Admin',
        avatarEmoji: '👨‍💻',
      }),
    });
    expect(userRes.status).toBe(200);
    const user = await userRes.json();
    expect(user.id).toBeDefined();

    // Create Room
    const roomRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/rooms`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Architecture & Security Deck',
        mode: 'mention',
        memberInstanceIds: [instance.id],
        memberUserIds: [user.id],
      }),
    });
    expect(roomRes.status).toBe(200);
    const room = await roomRes.json();
    expect(room.id).toBeDefined();

    // Post message
    const msgRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/rooms/${room.id}/messages`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        content: 'Hello @LiveClaudeArchitect please confirm architecture',
        senderUserId: user.id,
        senderDisplayName: user.displayName,
      }),
    });
    expect(msgRes.status).toBe(200);

    // Get messages
    const getMsgs = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/rooms/${room.id}/messages`, {
      headers: authHeaders,
    });
    expect(getMsgs.status).toBe(200);
    const msgs = await getMsgs.json();
    expect(msgs.length).toBe(1);

    // Doctor endpoint
    const docRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/doctor`, { headers: authHeaders });
    expect(docRes.status).toBe(200);
    const doc = await docRes.json();
    expect(doc.sqliteIntegrity).toBe(true);

    // Plugins endpoint
    const pluginsRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/plugins`, { headers: authHeaders });
    expect(pluginsRes.status).toBe(200);
    const plugins = await pluginsRes.json();
    expect(Array.isArray(plugins)).toBe(true);
  });

  // 3. Real WebSocket Streaming & Event Protocol — driven by a REAL run.
  // (This test used to hand-emit the very run:chunk event it claimed to
  // verify; now the engine must produce it end-to-end through /rooms/:id/run.)
  it('3. Real WebSocket Protocol Connection, Streaming & Events', async () => {
    const authHeaders = {
      Authorization: `Bearer ${TEST_TOKEN}`,
      'Content-Type': 'application/json',
    };

    // Fixture: one active mock agent in a room (auto-routes as single agent).
    const installations = await manager.scanAndSyncInstallations();
    const persona = await manager.createPersona({
      name: 'Streamer',
      role: 'Streaming Agent',
      language: 'en-US',
      systemPromptOverlay: 'stream everything',
      avatarEmoji: '📡',
      isTemplate: false,
    });
    const inst = await manager.createAgentInstance({
      installationId: installations[0]!.id,
      personaId: persona.id,
      name: 'StreamBot',
    });
    const room = await manager.createRoom({
      name: 'streaming-room',
      mode: 'mention',
      memberInstanceIds: [inst.id],
    });

    const wsUrl = `ws://127.0.0.1:${TEST_PORT}/ws?token=${TEST_TOKEN}`;
    const receivedEvents: Array<{ type: string; payload: Record<string, unknown>; roomId?: string }> = [];

    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    ws.on('message', (data) => {
      try {
        receivedEvents.push(JSON.parse(data.toString()));
      } catch {
        // ignore
      }
    });

    const runRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/rooms/${room.id}/run`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ prompt: 'stream please', userId: 'user-e2e', userName: 'E2E' }),
    });
    expect(runRes.status).toBe(200);
    const result = await runRes.json();
    expect(result.status).toBe('completed');
    expect(result.turnsExecuted).toBe(1);

    // Give the coalesced flush + socket fan-out a moment to land.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const types = receivedEvents.map((e) => e.type);
    expect(types).toContain('run:started');
    expect(types).toContain('run:turn:started');
    expect(types).toContain('run:chunk');
    expect(types).toContain('run:turn:completed');
    expect(types).toContain('message:created');
    expect(types).toContain('run:completed');

    const chunkEvents = receivedEvents.filter((e) => e.type === 'run:chunk');
    expect(chunkEvents.length).toBeGreaterThan(0);
    const chunk = chunkEvents[0]!;
    expect(chunk.payload.runId).toBe(result.runId);
    expect(chunk.payload.instanceName).toBe('StreamBot');
    expect(chunk.payload.turnIndex).toBe(1);
    expect(chunk.payload.seq).toBe(0);
    expect(String(chunk.payload.text).length).toBeGreaterThan(0);
    // Envelope metadata now carries the room, enabling client-side filtering.
    expect(chunk.roomId).toBe(room.id);


    ws.close();
  });

  // 3b. Abort a live run via REST — cancels cleanly, no error message posted.
  it('3b. POST /rooms/:id/abort cancels a live run without posting failures', async () => {
    const authHeaders = {
      Authorization: `Bearer ${TEST_TOKEN}`,
      'Content-Type': 'application/json',
    };

    // A deliberately slow adapter so the run is abortable mid-turn.
    const state = {
      availability: 'available',
      installation: 'installed',
      configuration: 'configured',
      authentication: 'authenticated',
      health: 'healthy',
      version: 'current',
      runtime: 'stopped',
    };
    manager.registerAdapter({
      definition: {
        id: 'slow-e2e',
        name: 'Slow E2E Agent',
        description: 'test-only slow adapter',
        version: '1.0.0',
        capabilities: {},
        rollbackCapabilities: { config: false, binary: false },
        supportedPlatforms: ['linux'],
        supportedArchitectures: ['x64'],
      },
      capabilities: {},
      rollbackCapabilities: { config: false, binary: false },
      detect: async () => ({ installed: true, binaryPath: '/bin/true', version: '1.0.0', state }),
      getLatestVersion: async () => ({ latestVersion: '1.0.0' }),
      execute: (ctx: { abortSignal: AbortSignal }) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ content: 'slow done' }), 8000);
          ctx.abortSignal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(ctx.abortSignal.reason ?? new Error('aborted'));
            },
            { once: true }
          );
        }),
    } as never);

    const installations = await manager.scanAndSyncInstallations();
    const slowInst = installations.find((i) => i.definitionId === 'slow-e2e')!;
    const persona = await manager.createPersona({
      name: 'Slowpoke',
      role: 'Slow Agent',
      language: 'en-US',
      systemPromptOverlay: 'take forever',
      avatarEmoji: '🐢',
      isTemplate: false,
    });
    const inst = await manager.createAgentInstance({
      installationId: slowInst.id,
      personaId: persona.id,
      name: 'SlowBot',
    });
    const room = await manager.createRoom({
      name: 'abort-room',
      mode: 'mention',
      memberInstanceIds: [inst.id],
    });

    const wsUrl = `ws://127.0.0.1:${TEST_PORT}/ws?token=${TEST_TOKEN}`;
    const receivedEvents: Array<{ type: string }> = [];
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    ws.on('message', (data) => {
      try {
        receivedEvents.push(JSON.parse(data.toString()));
      } catch {
        // ignore
      }
    });

    // Kick the (blocking) run off concurrently, then abort by room.
    const runPromise = fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/rooms/${room.id}/run`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ prompt: 'work forever', userId: 'user-e2e', userName: 'E2E' }),
    });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const abortRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/rooms/${room.id}/abort`, {
      method: 'POST',
      // No Content-Type: the route takes no body, and Fastify 400s an empty
      // JSON body — the web stop button posts the same bare request.
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(abortRes.status).toBe(200);
    const abortJson = await abortRes.json();
    expect(abortJson.aborted).toBe(1);

    const result = await (await runPromise).json();
    expect(result.status).toBe('cancelled');
    expect(result.deliveryTrace.state).toBe('cancelled');
    expect(result.deliveryTrace.reasonCode).toBe('run_aborted');

    // A user stop is not a failure: no error message lands in the room.
    const msgs = await (
      await fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/rooms/${room.id}/messages`, { headers: authHeaders })
    ).json();
    expect(JSON.stringify(msgs)).not.toContain('Agent execution failed');

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(receivedEvents.map((e) => e.type)).toContain('run:cancelled');

    ws.close();
  }, 15_000);

  // 3c. Room-scoped WS subscriptions: a subscribed socket must not receive
  // another room's run traffic (cross-room chunk leak).
  it('3c. WS subscribe scopes run events to the subscribed room', async () => {
    const authHeaders = {
      Authorization: `Bearer ${TEST_TOKEN}`,
      'Content-Type': 'application/json',
    };

    const installations = await manager.scanAndSyncInstallations();
    const persona = await manager.createPersona({
      name: 'Scoper',
      role: 'Scoping Agent',
      language: 'en-US',
      systemPromptOverlay: 'stay in your room',
      avatarEmoji: '🚪',
      isTemplate: false,
    });
    const makeRoom = async (name: string) => {
      const inst = await manager.createAgentInstance({
        installationId: installations[0]!.id,
        personaId: persona.id,
        name: `${name}-bot`,
      });
      return manager.createRoom({ name, mode: 'mention', memberInstanceIds: [inst.id] });
    };
    const roomA = await makeRoom('scoped-a');
    const roomB = await makeRoom('scoped-b');

    const received: Array<{ type: string; roomId?: string }> = [];
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws?token=${TEST_TOKEN}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'subscribe', roomId: roomA.id }));
        resolve();
      });
      ws.on('error', reject);
    });
    ws.on('message', (data) => {
      try {
        received.push(JSON.parse(data.toString()));
      } catch {
        // ignore
      }
    });

    const runIn = (roomId: string) =>
      fetch(`http://127.0.0.1:${TEST_PORT}/api/v1/rooms/${roomId}/run`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ prompt: 'scoped hello', userId: 'user-e2e', userName: 'E2E' }),
      });

    await runIn(roomB.id);
    await runIn(roomA.id);
    await new Promise((resolve) => setTimeout(resolve, 250));

    const roomEvents = received.filter((e) => e.roomId);
    expect(roomEvents.length).toBeGreaterThan(0);
    expect(roomEvents.every((e) => e.roomId === roomA.id)).toBe(true);
    expect(received.some((e) => e.type === 'run:chunk' && e.roomId === roomA.id)).toBe(true);

    ws.close();
  }, 15_000);

  // 4. Prompt Inspector Runtime Test & Secret Redaction
  it('4. Prompt Inspector Runtime Test (8-layer provenance & secret sanitization)', async () => {
    const installations = await manager.scanAndSyncInstallations();
    const persona = await manager.createPersona({
      name: 'Safe Inspector',
      role: 'Inspector',
      language: 'pt-BR',
      systemPromptOverlay: 'Inspect safely without leaking secrets',
      avatarEmoji: '🛡️',
      isTemplate: false,
    });

    const inst = await manager.createAgentInstance({
      installationId: installations[0]!.id,
      personaId: persona.id,
      name: 'SafeInstance',
    });

    const fakeSecret = 'sk-ant-api03-abcdef1234567890abcdef1234567890';
    const trigger = `Please process this confidential key: ${fakeSecret}`;

    const tree = composer.compose({
      instanceId: inst.id,
      persona,
      globalPolicy: 'Safety policy',
      workspaceContext: '/tmp/workspace',
      roomInstructions: 'Mention mode',
      adapterInstructions: 'Tuning options',
      history: [
        {
          id: 'm-prev',
          roomId: 'r-1',
          senderType: 'user',
          senderId: 'u-1',
          senderDisplayName: 'Michel',
          content: 'Previous prompt',
          contentType: 'text',
          createdAt: new Date().toISOString(),
        },
      ],
      triggerMessage: trigger,
      redact: true,
    });

    expect(tree.layers.length).toBe(8);
    expect(tree.finalRawPrompt).not.toContain(fakeSecret);
    expect(tree.finalRawPrompt).toContain('[REDACTED_SECRET]');

    // Test secret redaction utility directly
    const redacted = redactSecrets(`Bearer ${fakeSecret} and eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMCda8Yhe3iZaWbvV5XKSTbuAn0M`);
    expect(redacted).not.toContain(fakeSecret);
    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  // 5. Orchestration Modes & Guardrails (Mention, Panel, Debate, Coordinator, Abort)
  it('5. Orchestration Runtime Modes & Guardrails', async () => {
    const installations = await manager.scanAndSyncInstallations();
    const persona = await manager.createPersona({
      name: 'OrchestratorBot',
      role: 'Bot',
      language: 'en-US',
      systemPromptOverlay: 'Respond in clean turns',
      avatarEmoji: '🤖',
      isTemplate: false,
    });

    const inst1 = await manager.createAgentInstance({
      installationId: installations[0]!.id,
      personaId: persona.id,
      name: 'Bot1',
    });

    const inst2 = await manager.createAgentInstance({
      installationId: installations[1]!.id,
      personaId: persona.id,
      name: 'Bot2',
    });

    const user = await manager.createOrGetLocalProfile('Tester', '🧪');

    // Test @all Broadcast in Mention room
    const roomAll = await manager.createRoom({
      name: 'RoomAll',
      mode: 'mention',
      memberInstanceIds: [inst1.id, inst2.id],
      memberUserIds: [user.id],
    });

    const resAll = await engine.executeRun({
      roomId: roomAll.id,
      triggerMessage: '@all please acknowledge test run',
      senderUserId: user.id,
      senderDisplayName: 'Tester',
    });
    expect(resAll.status).toBe('completed');
    expect(resAll.turnsExecuted).toBe(2);

    // Test Debate Mode
    const roomDebate = await manager.createRoom({
      name: 'RoomDebate',
      mode: 'debate',
      memberInstanceIds: [inst1.id, inst2.id],
      memberUserIds: [user.id],
    });

    const resDebate = await engine.executeRun({
      roomId: roomDebate.id,
      triggerMessage: 'Debate: SQLite vs Flat JSON for local multi-agent management',
      senderUserId: user.id,
      senderDisplayName: 'Tester',
    });
    expect(resDebate.status).toBe('completed');
    // Structured roles: proposer (Bot1) + critique (Bot2) + synthesis (Bot1).
    expect(resDebate.turnsExecuted).toBe(3);
    const debateRoles = resDebate.messages
      .map((m) => (m.rawPayload as { debateRole?: string } | undefined)?.debateRole)
      .filter(Boolean);
    expect(debateRoles).toEqual(['proposer', 'critique', 'synthesis']);

    // Test AbortController Guardrail
    const abortCtrl = new AbortController();
    const promise = engine.executeRun({
      roomId: roomDebate.id,
      triggerMessage: 'Debate turn to be aborted',
      senderUserId: user.id,
      senderDisplayName: 'Tester',
      abortSignal: abortCtrl.signal,
    });
    abortCtrl.abort();
    const resAborted = await promise;
    expect(resAborted.status).toBe('cancelled');
  });
});

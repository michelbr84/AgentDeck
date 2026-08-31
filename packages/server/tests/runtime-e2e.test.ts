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

  // 3. Real WebSocket Streaming & Event Protocol
  it('3. Real WebSocket Protocol Connection, Streaming & Events', async () => {
    const wsUrl = `ws://127.0.0.1:${TEST_PORT}/ws?token=${TEST_TOKEN}`;
    const receivedEvents: Array<{ type: string; payload?: { text?: string } }> = [];

    const ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        // Send initial connection handshake / ping
        ws.send(JSON.stringify({ type: 'ping' }));
        resolve();
      });
      ws.on('error', reject);
    });

    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        receivedEvents.push(parsed);
      } catch {
        // ignore
      }
    });

    // Broadcast an event via server manager event bus
    manager.eventBus.emit('run:chunk', {
      runId: 'run-e2e-1',
      instanceId: 'inst-1',
      text: 'Streaming token chunk verification',
    });

    // Wait a brief moment for socket message delivery
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(receivedEvents.length).toBeGreaterThan(0);
    const chunkEvent = receivedEvents.find((e) => e.type === 'run:chunk');
    expect(chunkEvent).toBeDefined();
    expect(chunkEvent?.payload?.text).toBe('Streaming token chunk verification');

    ws.close();
  });

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
    expect(resDebate.turnsExecuted).toBe(4);

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

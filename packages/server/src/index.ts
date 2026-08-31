import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AgentDeckManager,
  ChatService,
  PROVIDER_CATALOG,
  RoutingService,
  validateModel,
} from '@agentdeck/core';
import { isLlmConfigurable } from '@agentdeck/adapter-sdk';
import { redactSecrets, timingSafeEqual } from '@agentdeck/security';
import { AGENTDECK_PATHS, AGENTDECK_VERSION, AGENTDECK_BUILD_INFO } from '@agentdeck/shared';
import type { Persona, RoomMode } from '@agentdeck/protocol';
import { LlmRoutingSchema, ProviderBindingSchema } from '@agentdeck/protocol';
import { WebSocket } from 'ws';
export { WebSocket } from 'ws';

export interface ServerOptions {
  port?: number;
  host?: string;
  authToken?: string;
  allowLan?: boolean;
  manager?: AgentDeckManager;
  webRoot?: string;
}

export function resolveWebRoot(customWebRoot?: string): string | null {
  // 1. Explicit user override
  if (customWebRoot) {
    const resolved = path.resolve(customWebRoot);
    if (fs.existsSync(resolved) && fs.existsSync(path.join(resolved, 'index.html'))) {
      return resolved;
    }
    throw new Error(`Expected Web Deck bundle not found at specified --web-root: ${resolved}\nRun: pnpm --filter agentdeck-web build`);
  }

  // 2. Relative to server module location (Development / Monorepo or Packaged App)
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = path.dirname(currentFile);
    // Candidates in order of specificity:
    // a. Monorepo repo root: apps/web/dist
    // b. Packaged layout: ../../../../web/dist or ../../web/dist
    const candidates = [
      path.resolve(currentDir, '..', '..', 'apps', 'web', 'dist'),
      path.resolve(currentDir, '..', '..', '..', 'apps', 'web', 'dist'),
      path.resolve(currentDir, '..', '..', '..', '..', 'web', 'dist'),
      path.resolve(currentDir, '..', '..', '..', 'web', 'dist'),
      path.resolve(currentDir, '..', '..', 'web', 'dist'),
      path.resolve(currentDir, '..', 'web', 'dist'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'index.html'))) {
        return candidate;
      }
    }
  } catch {
    // ignore
  }

  // 3. Fallback to installed ~/.agentdeck/app/web/dist ONLY if packaged directory exists
  if (fs.existsSync(AGENTDECK_PATHS.WEB_DIST_DIR) && fs.existsSync(path.join(AGENTDECK_PATHS.WEB_DIST_DIR, 'index.html'))) {
    return path.resolve(AGENTDECK_PATHS.WEB_DIST_DIR);
  }

  return null;
}

export interface AgentDeckServerInstance extends FastifyInstance {
  webRoot: string | null;
}

export async function createAgentDeckServer(options?: ServerOptions): Promise<AgentDeckServerInstance> {
  const server = Fastify({
    logger: false,
  }) as unknown as AgentDeckServerInstance;

  const manager = options?.manager || (await AgentDeckManager.create());
  const routingService = new RoutingService(manager.db);
  const chatService = new ChatService(manager);
  const authToken = options?.authToken;

  // 1. CORS
  await server.register(cors, {
    origin: (origin, cb) => {
      // Allow localhost and local IP origins
      if (!origin || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
        return cb(null, true);
      }
      if (options?.allowLan) {
        return cb(null, true);
      }
      cb(new Error('Blocked by CORS policy'), false);
    },
  });

  // 2. WebSockets
  await server.register(fastifyWebsocket);

  // 3. Static Web Deck Serving
  const webRoot = resolveWebRoot(options?.webRoot);
  server.webRoot = webRoot;
  if (webRoot) {
    await server.register(fastifyStatic, {
      root: webRoot,
      prefix: '/',
      index: 'index.html',
      // wildcard MUST stay enabled: with `wildcard: false` @fastify/static
      // enumerates the bundle directory once at registration time, so any asset
      // produced by a later `pnpm --filter agentdeck-web build` 404s until the
      // daemon is restarted (index.html is read per-request and would point at
      // a hash the server refuses to serve -> blank Web Deck).
      wildcard: true,
    });

    // SPA fallback: handle GET requests for non-API/non-WS routes
    server.setNotFoundHandler(async (req, reply) => {
      const url = req.raw.url || '';
      // If it is an API route, return standard 404 JSON
      if (url.startsWith('/api/') || url.startsWith('/ws') || url.startsWith('/health')) {
        return reply.status(404).send({
          message: `Route ${req.method}:${url} not found`,
          error: 'Not Found',
          statusCode: 404,
        });
      }
      // For static assets that really do not exist, return 404
      if (url.startsWith('/assets/') || url.includes('.')) {
        return reply.status(404).send({
          message: `Asset ${url} not found`,
          error: 'Not Found',
          statusCode: 404,
        });
      }
      // Otherwise serve index.html for client-side routing
      return reply.sendFile('index.html');
    });
  }

  // Active connected websocket clients
  const activeSockets = new Set<WebSocket>();

  manager.eventBus.on('*', (envelope) => {
    // Every event-bus envelope passes through redactSecrets before hitting the
    // wire — new event payload field names must be checked against its
    // SENSITIVE_KEY_PATTERNS list or they will be blanked here.
    const sanitizedEnvelope = redactSecrets(envelope);
    const messageStr = JSON.stringify(sanitizedEnvelope);

    for (const socket of activeSockets) {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(messageStr);
        } catch {
          // Socket write failed
        }
      }
    }
  });

  // Token authentication hook if token is set
  if (authToken) {
    server.addHook('onRequest', async (req, reply) => {
      if (req.url.startsWith('/api/v1')) {
        const headerAuth = req.headers['authorization'];
        const token = headerAuth?.replace(/^Bearer\s+/i, '');
        if (!token || !timingSafeEqual(token, authToken)) {
          return reply.status(401).send({ error: 'Unauthorized: Invalid or missing authentication token' });
        }
      }
    });
  }

  // ==========================================
  // REST API (v1)
  // ==========================================

  // Health check & build info
  server.get('/health', async () => ({
    status: 'healthy',
    version: AGENTDECK_VERSION,
    build: AGENTDECK_BUILD_INFO,
    webRoot: server.webRoot,
  }));

  server.get('/api/v1/build-info', async () => ({
    version: AGENTDECK_VERSION,
    buildId: AGENTDECK_BUILD_INFO.buildId,
    builtAt: AGENTDECK_BUILD_INFO.builtAt,
    webRoot: server.webRoot,
  }));

  // List installations & scan
  server.get('/api/v1/agents', async () => {
    const installations = await manager.scanAndSyncInstallations();
    return redactSecrets(installations);
  });

  // Health check for specific agent
  server.post('/api/v1/agents/:id/health', async (req) => {
    const { id } = req.params as { id: string };
    const { level } = (req.body as { level?: 'level1_static' | 'level2_connectivity' }) || {};
    const report = await manager.checkAgentHealth(id, level || 'level1_static');
    return redactSecrets(report);
  });

  // Upgrade agent
  server.post('/api/v1/agents/:id/upgrade', async (req) => {
    const { id } = req.params as { id: string };
    const { dryRun, targetVersion } = (req.body as { dryRun?: boolean; targetVersion?: string }) || {};
    const adapter = manager.getAdapter(id);
    if (!adapter) {
      throw new Error(`Agent ${id} not found`);
    }
    const result = await manager.upgradeEngine.executeUpgrade(adapter, { dryRun, targetVersion });
    return redactSecrets(result);
  });

  // Install a missing agent. `/health` and `/upgrade` existed; without this the
  // Agents page could report "not installed" but do nothing about it.
  server.post('/api/v1/agents/:id/install', async (req) => {
    const { id } = req.params as { id: string };
    const adapter = manager.getAdapter(id);
    if (!adapter) throw new Error(`Agent ${id} not found`);
    await adapter.install();
    const detection = await adapter.detect();
    return redactSecrets({ ok: true, detection });
  });

  // Per-agent LLM capability + what each one currently points at.
  server.get('/api/v1/agents/llm', async () => {
    const out = [];
    for (const adapter of manager.getAllAdapters()) {
      if (!isLlmConfigurable(adapter)) {
        out.push({
          agentId: adapter.definition.id,
          name: adapter.definition.name,
          configurable: false,
        });
        continue;
      }
      const detection = await adapter.detect();
      const live = detection.installed ? await adapter.readLlmConfig() : null;
      out.push({
        agentId: adapter.definition.id,
        name: adapter.definition.name,
        configurable: true,
        installed: detection.installed,
        supportsBackup: adapter.llmConfig.supportsBackup,
        backupStrategy: adapter.llmConfig.backupStrategy,
        keyDelivery: adapter.llmConfig.keyDelivery,
        configFiles: adapter.llmConfig.configFiles,
        current: live?.primary ?? null,
        currentBackup: live?.backup ?? null,
        managedByAgentDeck: live?.managedByAgentDeck ?? false,
        warnings: live?.warnings ?? [],
      });
    }
    return redactSecrets(out);
  });

  // Deck-wide LLM routing.
  server.get('/api/v1/llm-routing', async () => {
    return redactSecrets({
      routing: await routingService.getRouting(),
      // Presence only — a value never leaves the secret store. Named
      // `credentialPresence` rather than `credentials` because redactSecrets
      // blanks any key ending in "credential(s)", and rightly so: a field with
      // that name should hold a secret. This one holds booleans.
      credentialPresence: await routingService.secretStore.status(),
    });
  });

  server.put('/api/v1/llm-routing', async (req) => {
    const routing = LlmRoutingSchema.parse(req.body);
    await routingService.setRouting(routing);
    return redactSecrets({ ok: true, routing });
  });

  // Apply the stored routing to every configurable agent.
  server.post('/api/v1/llm-routing/apply', async (req) => {
    const { dryRun, force, agentIds } = (req.body as {
      dryRun?: boolean;
      force?: boolean;
      agentIds?: string[];
    }) || {};
    const routing = await routingService.getRouting();
    if (!routing) throw new Error('No routing configured yet. Set one first.');

    const adapters = manager
      .getAllAdapters()
      .filter((a) => (agentIds ? agentIds.includes(a.definition.id) : true));
    const report = await routingService.applyToAgents(adapters, routing, {
      runId: new Date().toISOString().replace(/[:.]/g, '-'),
      dryRun: dryRun ?? false,
      force: force ?? false,
    });
    return redactSecrets(report);
  });

  // Per-instance override.
  server.get('/api/v1/instances/:id/llm-override', async (req) => {
    const { id } = req.params as { id: string };
    return redactSecrets({ override: await routingService.getOverride(id) });
  });

  server.put('/api/v1/instances/:id/llm-override', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { routing?: unknown } | null;
    const routing = body?.routing ? LlmRoutingSchema.parse(body.routing) : null;
    await routingService.setOverride(id, routing);
    return redactSecrets({ ok: true });
  });

  // Credential presence, never values.
  server.get('/api/v1/secrets/status', async () => {
    return { credentialPresence: await routingService.secretStore.status() };
  });

  // Store a credential. The value is written to the secret store and is never
  // echoed back, logged, or persisted in SQLite.
  server.put('/api/v1/secrets/:provider', async (req) => {
    const { provider } = req.params as { provider: string };
    const { value } = (req.body as { value?: string }) || {};
    if (!value) throw new Error('value is required');
    const ref = await routingService.secretStore.set(provider, value);
    return { ok: true, credentialRef: ref };
  });

  // Live model catalog + reachability for one provider.
  server.post('/api/v1/providers/test', async (req) => {
    const binding = ProviderBindingSchema.parse(req.body);
    const result = await validateModel(binding, {
      resolveSecret: () => routingService.secretStore.get(binding.providerId),
    });
    return redactSecrets(result);
  });

  server.get('/api/v1/providers/catalog', async () => {
    return PROVIDER_CATALOG.map((p) => ({
      id: p.id,
      label: p.label,
      summary: p.summary,
      defaultModel: p.defaultModel,
      suggestedModels: p.suggestedModels,
      requiresCredential: p.requiresCredential,
      keyUrl: p.keyUrl,
    }));
  });

  // Personas
  server.get('/api/v1/personas', async () => {
    const list = await manager.listPersonas();
    return redactSecrets(list);
  });

  server.get('/api/v1/personas/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const persona = await manager.getPersona(id);
    if (!persona) {
      return reply.status(404).send({ error: `Persona with ID ${id} not found` });
    }
    return redactSecrets(persona);
  });

  server.post('/api/v1/personas', async (req) => {
    const body = req.body as Omit<Persona, 'id' | 'createdAt' | 'updatedAt'>;
    const persona = await manager.createPersona(body);
    return redactSecrets(persona);
  });

  server.put('/api/v1/personas/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Partial<Omit<Persona, 'id' | 'createdAt' | 'updatedAt'>>;
    await manager.updatePersona(id, body);
    const updated = await manager.getPersona(id);
    if (!updated) {
      return reply.status(404).send({ error: `Persona with ID ${id} not found` });
    }
    return redactSecrets(updated);
  });

  server.delete('/api/v1/personas/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await manager.deletePersona(id);
      return { success: true };
    } catch (err: unknown) {
      const error = err as { code?: string; message: string; statusCode?: number };
      if (error.code === 'PERSONA_IN_USE' || error.statusCode === 409) {
        return reply.status(409).send({
          error: error.message,
          code: 'PERSONA_IN_USE',
        });
      }
      return reply.status(500).send({ error: error.message });
    }
  });

  server.post('/api/v1/personas/:id/duplicate', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { newName } = (req.body as { newName?: string }) || {};
    try {
      const duplicated = await manager.duplicatePersona(id, newName);
      return redactSecrets(duplicated);
    } catch (err: unknown) {
      const error = err as { message: string };
      return reply.status(404).send({ error: error.message });
    }
  });

  // Agent Instances
  server.get('/api/v1/instances', async () => {
    const list = await manager.listAgentInstances();
    return redactSecrets(list);
  });

  server.post('/api/v1/instances', async (req) => {
    const body = req.body as {
      installationId: string;
      personaId: string;
      name: string;
      modelAlias?: string;
      workspaceDir?: string;
      permissionTier?: 'safe' | 'developer' | 'autonomous' | 'custom';
      isActive?: boolean;
    };
    const instance = await manager.createAgentInstance(body);
    return redactSecrets(instance);
  });

  server.put('/api/v1/instances/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string;
      personaId?: string;
      modelAlias?: string | null;
      workspaceDir?: string | null;
      permissionTier?: 'safe' | 'developer' | 'autonomous' | 'custom';
      isActive?: boolean;
    };
    await manager.updateAgentInstance(id, body);
    const list = await manager.listAgentInstances();
    const updated = list.find((i) => i.id === id);
    if (!updated) {
      return reply.status(404).send({ error: `AgentInstance with ID ${id} not found` });
    }
    return redactSecrets(updated);
  });

  server.post('/api/v1/instances/:id/toggle-active', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body as { isActive?: boolean }) || {};
    const updated = await manager.toggleAgentInstanceActive(id, body.isActive);
    if (!updated) {
      return reply.status(404).send({ error: `AgentInstance with ID ${id} not found` });
    }
    return redactSecrets(updated);
  });

  server.delete('/api/v1/instances/:id', async (req) => {
    const { id } = req.params as { id: string };
    await manager.deleteAgentInstance(id);
    return { success: true };
  });

  // Users (People / Local Profiles)
  server.get('/api/v1/users', async () => {
    const users = await manager.listUsers();
    return redactSecrets(users);
  });

  server.post('/api/v1/users', async (req) => {
    const { displayName, avatar } = req.body as { displayName: string; avatar?: string };
    const user = await manager.createOrGetLocalProfile(displayName, avatar);
    return redactSecrets(user);
  });

  // Rooms
  server.get('/api/v1/rooms', async () => {
    const rooms = await manager.listRooms();
    return redactSecrets(rooms);
  });

  server.get('/api/v1/rooms/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const room = await manager.getRoom(id);
    if (!room) {
      return reply.status(404).send({ error: `Room with ID ${id} not found` });
    }
    return redactSecrets(room);
  });

  server.post('/api/v1/rooms', async (req) => {
    const body = req.body as {
      name: string;
      description?: string;
      mode?: RoomMode;
      defaultAgentInstanceId?: string | null;
      workspacePath?: string;
      memberInstanceIds?: string[];
      memberUserIds?: string[];
    };
    const room = await manager.createRoom(body);
    return redactSecrets(room);
  });

  server.put('/api/v1/rooms/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string;
      description?: string;
      mode?: RoomMode;
      defaultAgentInstanceId?: string | null;
      maxTurnsPerRun?: number;
      maxRuntimeSec?: number;
      maxCostUSD?: number;
      workspacePath?: string;
    };
    await manager.updateRoom(id, body);
    const updated = await manager.getRoom(id);
    if (!updated) {
      return reply.status(404).send({ error: `Room with ID ${id} not found` });
    }
    return redactSecrets(updated);
  });

  server.post('/api/v1/rooms/:id/default-agent', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { defaultAgentInstanceId: string | null };
    await manager.setDefaultAgentInstanceForRoom(id, body.defaultAgentInstanceId ?? null);
    const updated = await manager.getRoom(id);
    if (!updated) {
      return reply.status(404).send({ error: `Room with ID ${id} not found` });
    }
    return redactSecrets(updated);
  });

  server.get('/api/v1/rooms/:id/members', async (req) => {
    const { id } = req.params as { id: string };
    const members = await manager.listRoomMembers(id);
    return redactSecrets(members);
  });

  server.post('/api/v1/rooms/:id/members', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      memberType: 'agent_instance' | 'user';
      memberId: string;
      role?: 'owner' | 'admin' | 'participant' | 'observer';
    };
    const member = await manager.addRoomMember(id, body.memberType, body.memberId, body.role);
    return redactSecrets(member);
  });

  server.delete('/api/v1/rooms/:id/members/:memberId', async (req) => {
    const { id, memberId } = req.params as { id: string; memberId: string };
    await manager.removeRoomMember(id, memberId);
    return { success: true };
  });

  server.get('/api/v1/rooms/:id/messages', async (req) => {
    const { id } = req.params as { id: string };
    const query = req.query as { limit?: string; before?: string; after?: string };
    const paged = query.limit !== undefined || query.before !== undefined || query.after !== undefined;

    // Back-compat: with no pagination params the response stays a bare array.
    if (!paged) {
      return redactSecrets(await manager.getRoomMessages(id));
    }

    const limit = Math.min(Math.max(1, Number(query.limit ?? 50) || 50), 100);
    const page = await manager.getRoomMessages(id, { limit, before: query.before, after: query.after });
    return redactSecrets(page);
  });

  server.post('/api/v1/rooms/:id/messages', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { senderType?: 'user' | 'agent_instance'; senderId?: string; senderDisplayName?: string; content: string };
    const msg = await manager.postMessage({
      roomId: id,
      senderType: body.senderType || 'user',
      senderId: body.senderId || 'user-default',
      senderDisplayName: body.senderDisplayName || 'User',
      content: body.content,
    });
    return redactSecrets(msg);
  });

  // Multi-agent run trigger
  server.post('/api/v1/rooms/:id/run', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { prompt?: string; message?: string; userId?: string; userName?: string; mode?: RoomMode };
    const result = await chatService.send({
      roomId: id,
      content: body.prompt || body.message || '',
      senderUserId: body.userId || 'user-default',
      senderDisplayName: body.userName || 'User',
      mode: body.mode,
    });
    return redactSecrets(result);
  });

  // Inspect Prompt (Non-destructive inspection with layer provenance & redactions)
  server.post('/api/v1/inspect-prompt', async (req) => {
    const body = req.body as { instanceId?: string; workspaceContext?: string; roomInstructions?: string; triggerMessage?: string };
    const instances = await manager.listAgentInstances();
    const targetInstance = instances.find((i) => i.id === body.instanceId) || instances[0];

    if (!targetInstance) {
      throw new Error('No agent instances available for prompt composition inspection');
    }

    const tree = manager.promptComposer.compose({
      instanceId: targetInstance.id,
      persona: targetInstance.persona,
      globalPolicy: 'Deliver concise and high quality answers.',
      workspaceContext: body.workspaceContext || process.cwd(),
      roomInstructions: body.roomInstructions,
      triggerMessage: body.triggerMessage || 'Design the architecture.',
      redact: true,
    });

    return redactSecrets(tree);
  });

  // Doctor endpoint
  server.get('/api/v1/doctor', async () => {
    const integrity = await manager.db.integrityCheck();
    const installations = await manager.scanAndSyncInstallations();
    return {
      sqliteIntegrity: integrity.ok,
      sqliteMessage: integrity.message,
      installationsCount: installations.length,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    };
  });

  // Plugins endpoint
  server.get('/api/v1/plugins', async () => {
    const plugins = await manager.listPlugins();
    return redactSecrets(plugins.map((p) => p.definition));
  });

  // ==========================================
  // WEBSOCKET STREAM ROUTE
  // ==========================================
  server.get('/ws', { websocket: true }, (socket) => {
    activeSockets.add(socket);

    socket.on('close', () => {
      activeSockets.delete(socket);
    });

    socket.on('message', async (rawMsg) => {
      try {
        const parsed = JSON.parse(rawMsg.toString('utf8'));
        if (parsed.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        }
      } catch {
        // Invalid json
      }
    });
  });

  return server;
}

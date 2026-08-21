import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AgentDeckManager, MultiAgentOrchestrationEngine } from '@agentdeck/core';
import { redactSecrets, timingSafeEqual } from '@agentdeck/security';
import { AGENTDECK_PATHS } from '@agentdeck/shared';
import type { Persona, RoomMode } from '@agentdeck/protocol';
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
  if (customWebRoot && fs.existsSync(customWebRoot) && fs.existsSync(path.join(customWebRoot, 'index.html'))) {
    return path.resolve(customWebRoot);
  }

  // 1. Check relative to ~/.agentdeck/app/web/dist (production installer layout)
  if (fs.existsSync(AGENTDECK_PATHS.WEB_DIST_DIR) && fs.existsSync(path.join(AGENTDECK_PATHS.WEB_DIST_DIR, 'index.html'))) {
    return path.resolve(AGENTDECK_PATHS.WEB_DIST_DIR);
  }

  // 2. Check relative to CLI or Server module location in bundle/install layout
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = path.dirname(currentFile);
    // e.g. dist/index.js -> ../web/dist or ../../web/dist or ../../apps/web/dist
    const candidates = [
      path.resolve(currentDir, '..', 'web', 'dist'),
      path.resolve(currentDir, '..', '..', 'web', 'dist'),
      path.resolve(currentDir, '..', '..', '..', 'web', 'dist'),
      path.resolve(currentDir, '..', '..', 'apps', 'web', 'dist'),
      path.resolve(currentDir, '..', '..', '..', 'apps', 'web', 'dist'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'index.html'))) {
        return candidate;
      }
    }
  } catch {
    // ignore
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
  const engine = new MultiAgentOrchestrationEngine(manager);
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
      wildcard: false,
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
    // Redact sensitive details before broadcasting over WebSocket
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

  // Health check
  server.get('/health', async () => ({ status: 'healthy', version: '1.0.1' }));

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

  // Personas
  server.get('/api/v1/personas', async () => {
    const list = await manager.listPersonas();
    return redactSecrets(list);
  });

  server.post('/api/v1/personas', async (req) => {
    const body = req.body as Omit<Persona, 'id' | 'createdAt' | 'updatedAt'>;
    const persona = await manager.createPersona(body);
    return redactSecrets(persona);
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
    };
    const instance = await manager.createAgentInstance(body);
    return redactSecrets(instance);
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

  server.post('/api/v1/rooms', async (req) => {
    const body = req.body as {
      name: string;
      description?: string;
      mode?: RoomMode;
      workspacePath?: string;
      memberInstanceIds?: string[];
      memberUserIds?: string[];
    };
    const room = await manager.createRoom(body);
    return redactSecrets(room);
  });

  server.get('/api/v1/rooms/:id/messages', async (req) => {
    const { id } = req.params as { id: string };
    const msgs = await manager.getRoomMessages(id);
    return redactSecrets(msgs);
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
    const result = await engine.executeRun({
      roomId: id,
      triggerMessage: body.prompt || body.message || '',
      senderUserId: body.userId || 'user-default',
      senderDisplayName: body.userName || 'User',
      modeOverride: body.mode,
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

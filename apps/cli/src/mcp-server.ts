/**
 * `agentdeck mcp-server` — exposes the deck itself as an MCP server over stdio.
 *
 * This is the channel that lets the agents talk to each other: every agent
 * registers this server, so any of them can list the others, ask one a
 * question, or post into a room, and the exchange is recorded where a human can
 * read it afterwards.
 *
 * Hard invariants, mirrored from GarraIA's own `garra mcp-server` and pinned by
 * tests:
 *   - **Nothing may be written to stdout except JSON-RPC.** A stray
 *     `console.log` corrupts the protocol stream and the host sees a hung
 *     server. Diagnostics go to stderr.
 *   - Every tool call passes the interop guardrails. A refusal is returned as a
 *     structured tool error, never thrown: throwing kills the *calling* agent's
 *     turn, which turns a guardrail into an outage.
 *
 * The protocol subset implemented here is deliberately small — `initialize`,
 * `tools/list`, `tools/call`, and the `notifications/initialized` no-op — which
 * is everything an MCP host needs to use tools.
 */
import readline from 'node:readline';
import {
  AgentDeckManager,
  DEFAULT_INTEROP_LIMITS,
  RateLimiter,
  capFanOut,
  checkCall,
  descend,
  type CallContext,
} from '@agentdeck/core';

const PROTOCOL_VERSION = '2025-11-25';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

/** The only function permitted to write to stdout. */
function respond(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

/** Diagnostics go to stderr so they cannot corrupt the JSON-RPC stream. */
function log(message: string): void {
  process.stderr.write(`[agentdeck mcp-server] ${message}\n`);
}

const TOOLS = [
  {
    name: 'agentdeck_list_agents',
    description:
      'List the agent instances on this deck, with the rooms each belongs to. ' +
      'Call this first to discover who you can talk to.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'agentdeck_ask',
    description:
      'Ask another agent instance a question and return its answer. ' +
      'Only agents that share a room with you are reachable.',
    inputSchema: {
      type: 'object',
      properties: {
        instanceId: { type: 'string', description: 'Target agent instance id.' },
        message: { type: 'string', description: 'What to ask.' },
        conversationId: {
          type: 'string',
          description: 'Reuse to continue a conversation; omit to start one.',
        },
      },
      required: ['instanceId', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'agentdeck_room_post',
    description:
      'Post a message into a room so its member agents can respond. ' +
      'Fan-out is capped; the result reports how many targets were dropped.',
    inputSchema: {
      type: 'object',
      properties: {
        roomId: { type: 'string' },
        message: { type: 'string' },
        conversationId: { type: 'string' },
      },
      required: ['roomId', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'agentdeck_room_history',
    description:
      'Read recent messages from a room. Without this a called agent has no ' +
      'context and the caller ends up pasting transcripts.',
    inputSchema: {
      type: 'object',
      properties: {
        roomId: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      required: ['roomId'],
      additionalProperties: false,
    },
  },
];

/** Wraps a payload in the MCP tool-result envelope. */
function toolResult(payload: unknown, isError = false): Record<string, unknown> {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError,
  };
}

export async function runMcpServer(): Promise<void> {
  const manager = await AgentDeckManager.create();
  const limiter = new RateLimiter();
  const conversations = new Map<string, CallContext>();
  /** Idempotency keys already served, so a retry cannot double-post. */
  const served = new Map<string, unknown>();

  log('ready');

  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let req: JsonRpcRequest;
    try {
      req = JSON.parse(line) as JsonRpcRequest;
    } catch {
      log(`ignoring unparseable line (${line.length} bytes)`);
      continue;
    }

    // Notifications carry no id and expect no response.
    if (req.id === undefined) continue;

    try {
      switch (req.method) {
        case 'initialize':
          respond({
            jsonrpc: '2.0',
            id: req.id,
            result: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: { name: 'agentdeck', version: '1.0.4' },
            },
          });
          break;

        case 'tools/list':
          respond({ jsonrpc: '2.0', id: req.id, result: { tools: TOOLS } });
          break;

        case 'tools/call': {
          const name = String(req.params?.['name'] ?? '');
          const args = (req.params?.['arguments'] ?? {}) as Record<string, unknown>;
          const result = await callTool(manager, limiter, conversations, served, name, args);
          respond({ jsonrpc: '2.0', id: req.id, result });
          break;
        }

        default:
          respond({
            jsonrpc: '2.0',
            id: req.id,
            error: { code: -32601, message: `method not found: ${req.method}` },
          });
      }
    } catch (err) {
      respond({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32603, message: (err as Error).message },
      });
    }
  }
}

async function callTool(
  manager: AgentDeckManager,
  limiter: RateLimiter,
  conversations: Map<string, CallContext>,
  served: Map<string, unknown>,
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const now = Date.now();

  if (name === 'agentdeck_list_agents') {
    const instances = await manager.listAgentInstances();
    const rooms = await manager.listRooms();
    const withRooms = await Promise.all(
      rooms.map(async (r) => ({ room: r, members: await manager.listRoomMembers(r.id) }))
    );
    return toolResult({
      agents: instances.map((i) => ({
        instanceId: i.id,
        name: i.name,
        isActive: i.isActive,
        rooms: withRooms
          .filter((wr) => wr.members.some((m) => m.memberId === i.id))
          .map((wr) => ({ roomId: wr.room.id, name: wr.room.name, mode: wr.room.mode })),
      })),
    });
  }

  if (name === 'agentdeck_room_history') {
    const roomId = String(args['roomId'] ?? '');
    const limit = Math.min(Number(args['limit'] ?? 20) || 20, 100);
    const messages = await manager.getRoomMessages(roomId, limit);
    return toolResult({
      roomId,
      messages: messages.map((m) => ({
        author: m.senderDisplayName,
        content: m.content,
        createdAt: m.createdAt,
      })),
    });
  }

  if (name === 'agentdeck_ask' || name === 'agentdeck_room_post') {
    const idempotencyKey = typeof args['idempotencyKey'] === 'string' ? args['idempotencyKey'] : null;
    if (idempotencyKey && served.has(idempotencyKey)) {
      return toolResult({ replayed: true, ...(served.get(idempotencyKey) as object) });
    }

    const conversationId =
      typeof args['conversationId'] === 'string' && args['conversationId']
        ? args['conversationId']
        : `mcp-${now}`;
    const caller = 'mcp-client';

    const rate = limiter.check(caller, now);
    if (!rate.allowed) return toolResult({ refused: rate.code, message: rate.message }, true);

    const ctx: CallContext =
      conversations.get(conversationId) ??
      { conversationId, callPath: [caller], startedAt: now, turnsUsed: 0 };

    if (name === 'agentdeck_ask') {
      const instanceId = String(args['instanceId'] ?? '');
      const reachable = await reachableInstanceIds(manager);
      const verdict = checkCall(ctx, instanceId, reachable, DEFAULT_INTEROP_LIMITS, now);
      if (!verdict.allowed) {
        // A structured refusal, not a thrown error: throwing would kill the
        // calling agent's whole turn.
        return toolResult({ refused: verdict.code, message: verdict.message }, true);
      }
      conversations.set(conversationId, descend(ctx, instanceId));

      // Route through the orchestration engine so the exchange is recorded in
      // a room rather than happening invisibly between two processes.
      const answer = await askInstance(manager, instanceId, String(args['message'] ?? ''));
      const payload = { conversationId, instanceId, answer };
      if (idempotencyKey) served.set(idempotencyKey, payload);
      return toolResult(payload);
    }

    // room_post
    const roomId = String(args['roomId'] ?? '');
    const members = await manager.listRoomMembers(roomId);
    const agentMembers = members.filter((m) => m.memberType === 'agent_instance');
    const { targets, dropped } = capFanOut(agentMembers);
    const payload = {
      conversationId,
      roomId,
      delivered: targets.length,
      // Never truncate silently: a capped broadcast that reports success reads
      // as "everyone got it".
      dropped,
      ...(dropped > 0
        ? { note: `Fan-out capped at ${DEFAULT_INTEROP_LIMITS.maxFanOut}; ${dropped} member(s) not contacted.` }
        : {}),
    };
    await manager.postMessage({
      roomId,
      senderType: 'agent_instance',
      senderId: caller,
      senderDisplayName: 'Agent (via MCP)',
      content: String(args['message'] ?? ''),
    });
    if (idempotencyKey) served.set(idempotencyKey, payload);
    return toolResult(payload);
  }

  return toolResult({ error: `unknown tool: ${name}` }, true);
}

/**
 * Asks one instance directly, recording the exchange in its first room.
 *
 * Goes through the deck rather than shelling out to the agent, so the request
 * and the answer both land somewhere a human can read them later.
 */
async function askInstance(
  manager: AgentDeckManager,
  instanceId: string,
  message: string
): Promise<string> {
  const rooms = await manager.listRooms();
  for (const room of rooms) {
    const members = await manager.listRoomMembers(room.id);
    if (!members.some((m) => m.memberType === 'agent_instance' && m.memberId === instanceId)) {
      continue;
    }
    const result = await manager.orchestrationEngine.executeRun({
      roomId: room.id,
      triggerMessage: message,
      senderUserId: 'mcp-client',
      senderDisplayName: 'Agent (via MCP)',
    });
    if (result.status !== 'completed') {
      throw new Error(result.error ?? `orchestration ${result.status}`);
    }
    return result.messages.map((m) => m.content).join('\n\n');
  }
  throw new Error(`instance ${instanceId} is not a member of any room`);
}

/**
 * Every agent instance that belongs to at least one room.
 *
 * Room membership *is* the allowlist: an agent may reach the agents it shares a
 * deck room with, not every agent registered on the machine.
 */
async function reachableInstanceIds(manager: AgentDeckManager): Promise<string[]> {
  const rooms = await manager.listRooms();
  const ids = new Set<string>();
  for (const room of rooms) {
    for (const member of await manager.listRoomMembers(room.id)) {
      if (member.memberType === 'agent_instance') ids.add(member.memberId);
    }
  }
  return [...ids];
}

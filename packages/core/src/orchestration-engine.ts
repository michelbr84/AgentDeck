import { AgentDeckManager } from './agent-deck-manager.js';
import {
  Room,
  Message,
  AgentInstance,
  Persona,
  AgentInstallation,
  ChatDeliveryTrace,
} from '@agentdeck/protocol';
import { DEFAULT_INTEROP_LIMITS } from './interop-guardrails.js';
import { RunAbortError, TurnTimeoutError, RunBudget } from './run-control.js';

export interface OrchestrationRunOptions {
  roomId: string;
  triggerMessage: string;
  senderUserId: string;
  senderDisplayName: string;
  modeOverride?: 'mention' | 'panel' | 'debate' | 'round_robin' | 'coordinator';
  abortSignal?: AbortSignal;
  /** Per-turn wall clock override; falls back to room.turnTimeoutSec, then the deck default. */
  turnTimeoutMs?: number;
  onTurnStart?: (instanceName: string, turnIndex: number) => void;
  onChunk?: (instanceName: string, chunk: string) => void;
  onTurnComplete?: (instanceName: string, message: Message) => void;
}

export interface OrchestrationResult {
  runId: string;
  roomId: string;
  status: 'completed' | 'cancelled' | 'failed' | 'paused';
  turnsExecuted: number;
  messages: Message[];
  tokensUsed: number;
  costUSD: number;
  deliveryTrace?: ChatDeliveryTrace;
  error?: string;
}

interface ResolvedRouting {
  targetInstances: Array<AgentInstance & { persona: Persona; installation: AgentInstallation }>;
  trace: ChatDeliveryTrace;
  shouldExecute: boolean;
  systemFeedbackMessage?: string;
}

/** Live token chunks are coalesced behind this flush interval — every emitted
 * envelope costs a redactSecrets deep clone plus one JSON.stringify per
 * connected WebSocket, so per-chunk emission would melt under fast agents. */
const CHUNK_FLUSH_MS = 50;

/**
 * Settles with the promise, or rejects with the signal's reason as soon as it
 * aborts — so an adapter that ignores its AbortSignal cannot pin the turn.
 * The raced promise's eventual rejection is swallowed to avoid unhandled
 * rejection noise after the turn has already moved on.
 */
function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => {});
    return Promise.reject(signal.reason ?? new Error('aborted'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      promise.catch(() => {});
      reject(signal.reason ?? new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

export class MultiAgentOrchestrationEngine {
  constructor(private manager: AgentDeckManager) {}

  /**
   * Resolves routing decision deterministically with explicit diagnostics and actionable feedback.
   */
  public resolveRouting(
    room: Room,
    triggerMessage: string,
    activeRoomInstances: Array<AgentInstance & { persona: Persona; installation: AgentInstallation }>
  ): ResolvedRouting {
    const timestamp = new Date().toISOString();
    const mode = room.mode;

    // 1. Zero agents in room
    if (activeRoomInstances.length === 0) {
      const trace: ChatDeliveryTrace = {
        state: 'no_target',
        reasonCode: 'zero_agents',
        feedbackMessage: 'This room has no active AI agents. Add an agent to start a conversation.',
        actionableHint: 'Add an agent to this room in Room Settings or choose a room with active members.',
        targetInstanceIds: [],
        targetInstanceNames: [],
        roomMode: mode,
        timestamp,
      };
      return {
        targetInstances: [],
        trace,
        shouldExecute: false,
        systemFeedbackMessage: 'ℹ️ This room has no active AI agents. Add an agent to start a conversation.',
      };
    }

    // Check for @all / @todos broadcast in any mode
    const text = triggerMessage.toLowerCase();
    if (text.includes('@all') || text.includes('@todos')) {
      const trace: ChatDeliveryTrace = {
        state: 'running',
        reasonCode: 'all_mention',
        feedbackMessage: `Broadcast to all ${activeRoomInstances.length} member agents via @all mention.`,
        actionableHint: undefined,
        targetInstanceIds: activeRoomInstances.map((i) => i.id),
        targetInstanceNames: activeRoomInstances.map((i) => i.name),
        roomMode: mode,
        timestamp,
      };
      return {
        targetInstances: activeRoomInstances,
        trace,
        shouldExecute: true,
      };
    }

    // Check for direct mentions
    const directMentions: Array<AgentInstance & { persona: Persona; installation: AgentInstallation }> = [];
    for (const inst of activeRoomInstances) {
      const nameTag = `@${inst.name.toLowerCase()}`;
      const personaTag = `@${inst.persona.name.toLowerCase()}`;
      const engineTag = `@${inst.installation.definitionId.toLowerCase()}`;

      if (
        text.includes(nameTag) ||
        text.includes(personaTag) ||
        text.includes(engineTag)
      ) {
        directMentions.push(inst);
      }
    }

    if (directMentions.length > 0) {
      const trace: ChatDeliveryTrace = {
        state: 'running',
        reasonCode: 'direct_mention',
        feedbackMessage: `Directly routed to ${directMentions.map((i) => i.name).join(', ')}.`,
        actionableHint: undefined,
        targetInstanceIds: directMentions.map((i) => i.id),
        targetInstanceNames: directMentions.map((i) => i.name),
        roomMode: mode,
        timestamp,
      };
      return {
        targetInstances: directMentions,
        trace,
        shouldExecute: true,
      };
    }

    // 2. Panel Mode (broadcasts to all active room members)
    if (mode === 'panel') {
      const trace: ChatDeliveryTrace = {
        state: 'running',
        reasonCode: 'panel_broadcast',
        feedbackMessage: `Broadcasting message to all ${activeRoomInstances.length} room members in Panel mode.`,
        actionableHint: undefined,
        targetInstanceIds: activeRoomInstances.map((i) => i.id),
        targetInstanceNames: activeRoomInstances.map((i) => i.name),
        roomMode: mode,
        timestamp,
      };
      return {
        targetInstances: activeRoomInstances,
        trace,
        shouldExecute: true,
      };
    }

    // 3. Debate / Round-Robin Mode
    if (mode === 'debate' || mode === 'round_robin') {
      const trace: ChatDeliveryTrace = {
        state: 'running',
        reasonCode: 'debate_turn',
        feedbackMessage: `Starting structured debate/turn across ${activeRoomInstances.length} members.`,
        actionableHint: undefined,
        targetInstanceIds: activeRoomInstances.map((i) => i.id),
        targetInstanceNames: activeRoomInstances.map((i) => i.name),
        roomMode: mode,
        timestamp,
      };
      return {
        targetInstances: activeRoomInstances,
        trace,
        shouldExecute: true,
      };
    }

    // 4. Coordinator Mode — the room's default agent leads when set.
    if (mode === 'coordinator') {
      const coordinator =
        (room.defaultAgentInstanceId &&
          activeRoomInstances.find((i) => i.id === room.defaultAgentInstanceId)) ||
        activeRoomInstances[0]!;
      const trace: ChatDeliveryTrace = {
        state: 'running',
        reasonCode: 'coordinator_delegate',
        feedbackMessage: `Delegating conversation to coordinator agent "${coordinator.name}".`,
        actionableHint: undefined,
        targetInstanceIds: [coordinator.id],
        targetInstanceNames: [coordinator.name],
        roomMode: mode,
        timestamp,
      };
      return {
        targetInstances: [coordinator],
        trace,
        shouldExecute: true,
      };
    }

    // 5. Mention Mode without direct mentions:
    // 5a. Exactly 1 active agent in room -> auto route
    if (activeRoomInstances.length === 1) {
      const single = activeRoomInstances[0]!;
      const trace: ChatDeliveryTrace = {
        state: 'running',
        reasonCode: 'single_agent_auto',
        feedbackMessage: `Automatically routed to "${single.name}" (only agent in room).`,
        actionableHint: undefined,
        targetInstanceIds: [single.id],
        targetInstanceNames: [single.name],
        roomMode: mode,
        timestamp,
      };
      return {
        targetInstances: [single],
        trace,
        shouldExecute: true,
      };
    }

    // 5b. Multiple agents + Room has defaultAgentInstanceId set
    if (room.defaultAgentInstanceId) {
      const defaultAgent = activeRoomInstances.find((i) => i.id === room.defaultAgentInstanceId);
      if (defaultAgent) {
        const trace: ChatDeliveryTrace = {
          state: 'running',
          reasonCode: 'room_default_agent',
          feedbackMessage: `Routed to default agent "${defaultAgent.name}".`,
          actionableHint: undefined,
          targetInstanceIds: [defaultAgent.id],
          targetInstanceNames: [defaultAgent.name],
          roomMode: mode,
          timestamp,
        };
        return {
          targetInstances: [defaultAgent],
          trace,
          shouldExecute: true,
        };
      }
    }

    // 5c. Multiple agents + No default agent -> no_target with actionable guidance
    const trace: ChatDeliveryTrace = {
      state: 'no_target',
      reasonCode: 'multiple_agents_no_target',
      feedbackMessage: 'Multiple agents are available. Choose a default agent, @mention an agent, or switch the room to Panel mode.',
      actionableHint: 'Set a default agent in Room Settings, use @<name> to direct your message, or switch room mode to Panel.',
      targetInstanceIds: [],
      targetInstanceNames: [],
      roomMode: mode,
      timestamp,
    };
    return {
      targetInstances: [],
      trace,
      shouldExecute: false,
      systemFeedbackMessage: 'ℹ️ Multiple agents are available. Choose a default agent, @mention an agent, or switch the room to Panel mode.',
    };
  }

  /**
   * Dispatches and coordinates multi-agent conversation according to Room mode, routing rules, and safety guardrails.
   */
  public async executeRun(options: OrchestrationRunOptions): Promise<OrchestrationResult> {
    const runId = `run-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const room = await this.manager.getRoom(options.roomId);

    if (!room) {
      throw new Error(`Room with ID "${options.roomId}" not found`);
    }

    const effectiveRoom: Room = {
      ...room,
      mode: options.modeOverride || room.mode,
    };

    // One controller per run, registered so REST/WS/UIs can abort by runId or
    // roomId; the caller's signal (if any) chains into it.
    const runController = new AbortController();
    const onExternalAbort = () => {
      // A caller aborting without a specific reason (plain controller.abort())
      // is a user-initiated stop, same as the registry's RunAbortError.
      const reason = options.abortSignal?.reason as unknown;
      const isDefaultAbort = reason == null || (reason instanceof Error && reason.name === 'AbortError');
      runController.abort(isDefaultAbort ? new RunAbortError() : reason);
    };
    if (options.abortSignal) {
      if (options.abortSignal.aborted) onExternalAbort();
      else options.abortSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
    this.manager.registerRun(runId, effectiveRoom.id, runController);
    const runSignal = runController.signal;

    try {
      const maxTurns = effectiveRoom.maxTurnsPerRun || 10;
      const budget = new RunBudget({
        maxTurns,
        maxRuntimeMs: effectiveRoom.maxRuntimeSec ? effectiveRoom.maxRuntimeSec * 1000 : undefined,
        maxCostUSD: effectiveRoom.maxCostUSD,
      });
      const allInstances = await this.manager.listAgentInstances();
      const members = await this.manager.listRoomMembers(effectiveRoom.id);
      const roomMemberInstanceIds = new Set(
        members.filter((m) => m.memberType === 'agent_instance').map((m) => m.memberId)
      );

      // Filter instances strictly to those that belong to the room AND are active.
      const activeRoomInstances = allInstances.filter(
        (i) => roomMemberInstanceIds.has(i.id) && i.isActive !== false
      );

      // Resolve routing
      const routing = this.resolveRouting(effectiveRoom, options.triggerMessage, activeRoomInstances);

      // 1. Post user trigger message with delivery trace attached
      const userMsg = await this.manager.postMessage({
        roomId: effectiveRoom.id,
        senderType: 'user',
        senderId: options.senderUserId,
        senderDisplayName: options.senderDisplayName,
        content: options.triggerMessage,
        contentType: 'text',
        deliveryTrace: routing.trace,
      });

      const producedMessages: Message[] = [userMsg];
      let turnsExecuted = 0;
      let totalTokens = 0;
      let totalCost = 0;

      this.manager.eventBus.emit(
        'run:started',
        {
          runId,
          roomId: effectiveRoom.id,
          mode: effectiveRoom.mode,
          activeInstances: routing.targetInstances.map((i) => i.id),
        },
        { runId, roomId: effectiveRoom.id }
      );

      if (!routing.shouldExecute || routing.targetInstances.length === 0) {
        // If actionable feedback message is provided, post a helpful system message in the room
        if (routing.systemFeedbackMessage) {
          const feedbackMsg = await this.manager.postMessage({
            roomId: effectiveRoom.id,
            senderType: 'user',
            senderId: 'system',
            senderDisplayName: 'AgentDeck Routing',
            content: routing.systemFeedbackMessage,
            contentType: 'system',
            deliveryTrace: routing.trace,
          });
          producedMessages.push(feedbackMsg);
        }

        this.manager.eventBus.emit(
          'run:completed',
          {
            runId,
            totalTurns: 0,
            totalCost: 0,
          },
          { runId, roomId: effectiveRoom.id }
        );

        return {
          runId,
          roomId: effectiveRoom.id,
          status: 'completed',
          turnsExecuted: 0,
          messages: producedMessages,
          tokensUsed: 0,
          costUSD: 0,
          deliveryTrace: routing.trace,
        };
      }

      try {
        if (effectiveRoom.mode === 'mention') {
          for (const target of routing.targetInstances) {
            if (runSignal.aborted) break;
            if (!budget.check().allowed) break;

            turnsExecuted++;
            budget.noteTurn();
            const msg = await this.executeSingleTurn(
              runId,
              effectiveRoom,
              target,
              options.triggerMessage,
              producedMessages,
              turnsExecuted,
              options,
              runSignal
            );
            if (msg) {
              producedMessages.push(msg);
              totalTokens += 150;
              totalCost += 0.0005;
              budget.noteCost(0.0005);
            }
          }
        } else if (effectiveRoom.mode === 'panel') {
          for (const inst of routing.targetInstances) {
            if (runSignal.aborted) break;
            if (!budget.check().allowed) break;

            turnsExecuted++;
            budget.noteTurn();
            const msg = await this.executeSingleTurn(
              runId,
              effectiveRoom,
              inst,
              options.triggerMessage,
              producedMessages,
              turnsExecuted,
              options,
              runSignal
            );
            if (msg) {
              producedMessages.push(msg);
              totalTokens += 150;
              totalCost += 0.0005;
              budget.noteCost(0.0005);
            }
          }
        } else if (effectiveRoom.mode === 'debate' || effectiveRoom.mode === 'round_robin') {
          for (let t = 0; t < Math.min(maxTurns, routing.targetInstances.length * 2); t++) {
            if (runSignal.aborted) break;
            if (!budget.check().allowed) break;
            const inst = routing.targetInstances[t % routing.targetInstances.length];
            if (!inst) break;

            turnsExecuted++;
            budget.noteTurn();
            const latestContext = producedMessages[producedMessages.length - 1]?.content || options.triggerMessage;
            const msg = await this.executeSingleTurn(
              runId,
              effectiveRoom,
              inst,
              latestContext,
              producedMessages,
              turnsExecuted,
              options,
              runSignal
            );
            if (msg) {
              producedMessages.push(msg);
              totalTokens += 150;
              totalCost += 0.0005;
              budget.noteCost(0.0005);
            }
          }
        } else if (effectiveRoom.mode === 'coordinator') {
          const coordinator = routing.targetInstances[0];
          if (coordinator && !runSignal.aborted && budget.check().allowed) {
            turnsExecuted++;
            budget.noteTurn();
            const msg = await this.executeSingleTurn(
              runId,
              effectiveRoom,
              coordinator,
              `Analyze the following request and coordinate with specialist personas: ${options.triggerMessage}`,
              producedMessages,
              turnsExecuted,
              options,
              runSignal
            );
            if (msg) producedMessages.push(msg);
          }
        }

        const aborted = runSignal.aborted;
        const finalTrace: ChatDeliveryTrace = aborted
          ? {
              ...routing.trace,
              state: 'cancelled',
              reasonCode: 'run_aborted',
              feedbackMessage: 'Run aborted before completion.',
            }
          : {
              ...routing.trace,
              state: 'completed',
            };

        if (aborted) {
          this.manager.eventBus.emit(
            'run:cancelled',
            { runId, roomId: effectiveRoom.id, totalTurns: turnsExecuted },
            { runId, roomId: effectiveRoom.id }
          );
        } else {
          this.manager.eventBus.emit(
            'run:completed',
            {
              runId,
              totalTurns: turnsExecuted,
              totalCost,
            },
            { runId, roomId: effectiveRoom.id }
          );
        }

        return {
          runId,
          roomId: effectiveRoom.id,
          status: aborted ? 'cancelled' : 'completed',
          turnsExecuted,
          messages: producedMessages,
          tokensUsed: totalTokens,
          costUSD: totalCost,
          deliveryTrace: finalTrace,
        };
      } catch (err) {
        const errorMsg = (err as Error).message;
        this.manager.eventBus.emit(
          'run:failed',
          { runId, error: errorMsg },
          { runId, roomId: effectiveRoom.id }
        );

        return {
          runId,
          roomId: effectiveRoom.id,
          status: 'failed',
          turnsExecuted,
          messages: producedMessages,
          tokensUsed: totalTokens,
          costUSD: totalCost,
          deliveryTrace: {
            ...routing.trace,
            state: 'failed',
            reasonCode: 'execution_error',
            feedbackMessage: `Execution error: ${errorMsg}`,
          },
          error: errorMsg,
        };
      }
    } finally {
      this.manager.unregisterRun(runId);
      options.abortSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  private async executeSingleTurn(
    runId: string,
    room: Room,
    instance: AgentInstance & { persona: Persona; installation: AgentInstallation },
    triggerText: string,
    history: Message[],
    turnIndex: number,
    options: OrchestrationRunOptions,
    runSignal: AbortSignal
  ): Promise<Message | null> {
    const adapter = this.manager.getAdapter(instance.installation.definitionId);
    if (!adapter) return null;

    options.onTurnStart?.(instance.name, turnIndex);

    // Compose prompt tree
    const promptTree = this.manager.promptComposer.compose({
      instanceId: instance.id,
      persona: instance.persona,
      globalPolicy: 'Deliver precise, actionable, clear, and production-grade software answers.',
      workspaceContext: room.workspacePath || process.cwd(),
      roomInstructions: `Room #${room.name} Mode: ${room.mode}. Turn ${turnIndex}.`,
      history: history.slice(-10),
      triggerMessage: triggerText,
    });

    const emitMeta = { runId, roomId: room.id, instanceId: instance.id };
    const turnInfo = {
      runId,
      roomId: room.id,
      instanceId: instance.id,
      instanceName: instance.name,
      turnIndex,
    };
    this.manager.eventBus.emit('run:turn:started', turnInfo, emitMeta);

    // Per-turn controller chained onto the run signal with {once} + removal in
    // finally — a long run must not accumulate listeners on the shared signal.
    const abortCtrl = new AbortController();
    const onRunAbort = () => abortCtrl.abort(runSignal.reason);
    if (runSignal.aborted) onRunAbort();
    else runSignal.addEventListener('abort', onRunAbort, { once: true });

    // Per-turn wall clock, distinct from the run-level maxRuntimeSec cap.
    const timeoutMs =
      options.turnTimeoutMs ??
      (room.turnTimeoutSec ? room.turnTimeoutSec * 1000 : DEFAULT_INTEROP_LIMITS.turnTimeoutMs);
    const timeoutTimer = setTimeout(
      () => abortCtrl.abort(new TurnTimeoutError(`Turn timed out after ${Math.round(timeoutMs / 1000)}s`)),
      timeoutMs
    );

    // Coalesced streaming: buffer chunks and flush on a short timer with a
    // monotonic seq, so the event bus (and each WebSocket) sees a bounded rate.
    let seq = 0;
    let pendingChunk = '';
    let flushTimer: NodeJS.Timeout | null = null;
    const flushChunks = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (!pendingChunk) return;
      const text = pendingChunk;
      pendingChunk = '';
      this.manager.eventBus.emit('run:chunk', { ...turnInfo, seq: seq++, text }, emitMeta);
    };

    let answerText = '';
    try {
      const execution = adapter.execute({
        runId,
        sessionId: `session-${instance.id}`,
        promptTree,
        workspaceDir: room.workspacePath,
        abortSignal: abortCtrl.signal,
        turnRequest: {
          runId,
          sessionId: `session-${instance.id}`,
          instanceId: instance.id,
          roomId: room.id,
          messages: [],
          promptTree,
          workspaceDir: room.workspacePath,
          timeoutMs,
        },
        onChunk: (chunk) => {
          answerText += chunk;
          pendingChunk += chunk;
          if (!flushTimer) flushTimer = setTimeout(flushChunks, CHUNK_FLUSH_MS);
          options.onChunk?.(instance.name, chunk);
        },
      });
      const execResult = await raceWithAbort(execution, abortCtrl.signal);

      const rawContent = (execResult.content || answerText || '').trim();
      if (!rawContent) {
        throw new Error(`EMPTY_AGENT_RESPONSE: ${instance.name} produced no response.`);
      }

      // Emit any buffered tail before the persisted message lands, so clients
      // never see message:created while chunks are still trailing in.
      flushChunks();

      const msg = await this.manager.postMessage({
        roomId: room.id,
        senderType: 'agent_instance',
        senderId: instance.id,
        senderDisplayName: `${instance.persona.avatarEmoji || '🤖'} ${instance.name}`,
        content: rawContent,
        contentType: 'text',
        turnIndex,
      });

      this.manager.eventBus.emit('run:turn:completed', { ...turnInfo, messageId: msg.id }, emitMeta);
      options.onTurnComplete?.(instance.name, msg);
      return msg;
    } catch (err) {
      const abortReason = abortCtrl.signal.aborted ? (abortCtrl.signal.reason as unknown) : undefined;

      // A user-initiated stop is not a failure: post nothing into the room.
      if (abortReason instanceof RunAbortError) {
        return null;
      }

      const rawError = (err as Error).message;
      let sanitizedReason = 'Agent execution failed.';
      if (abortReason instanceof TurnTimeoutError) {
        sanitizedReason = `Turn exceeded its ${Math.round(timeoutMs / 1000)}s timeout.`;
      } else if (rawError.includes('not found') || rawError.includes('ENOENT')) {
        sanitizedReason = 'Agent binary or executable was not found.';
      } else if (rawError.includes('rejected by security policy')) {
        sanitizedReason = 'Invalid runtime argument rejected by security policy.';
      } else if (rawError.includes('timed out') || rawError.includes('aborted')) {
        sanitizedReason = 'Execution timed out or was aborted.';
      } else {
        const firstLine = rawError.split('\n')[0]?.slice(0, 120) || 'Internal runtime error';
        sanitizedReason = firstLine;
      }

      this.manager.eventBus.emit('run:turn:failed', { ...turnInfo, error: sanitizedReason }, emitMeta);

      const userFacingErrorMessage = `⚠️ Agent execution failed.\nReason: ${sanitizedReason}\nRun \`agentdeck doctor ${instance.installation.definitionId}\` or inspect system logs for details.`;

      const fallbackMsg = await this.manager.postMessage({
        roomId: room.id,
        senderType: 'agent_instance',
        senderId: instance.id,
        senderDisplayName: `${instance.persona.avatarEmoji || '🤖'} ${instance.name}`,
        content: userFacingErrorMessage,
        contentType: 'text',
        turnIndex,
      });
      return fallbackMsg;
    } finally {
      clearTimeout(timeoutTimer);
      runSignal.removeEventListener('abort', onRunAbort);
      flushChunks();
    }
  }
}

import { AgentDeckManager } from './agent-deck-manager.js';
import {
  Room,
  Message,
  AgentInstance,
  Persona,
  AgentInstallation,
  ChatDeliveryTrace,
} from '@agentdeck/protocol';

export interface OrchestrationRunOptions {
  roomId: string;
  triggerMessage: string;
  senderUserId: string;
  senderDisplayName: string;
  modeOverride?: 'mention' | 'panel' | 'debate' | 'round_robin' | 'coordinator';
  abortSignal?: AbortSignal;
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

    // 4. Coordinator Mode
    if (mode === 'coordinator') {
      const coordinator = activeRoomInstances[0]!;
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

    const maxTurns = effectiveRoom.maxTurnsPerRun || 10;
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

    this.manager.eventBus.emit('run:started', {
      runId,
      roomId: effectiveRoom.id,
      mode: effectiveRoom.mode,
      activeInstances: routing.targetInstances.map((i) => i.id),
    });

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

      this.manager.eventBus.emit('run:completed', {
        runId,
        totalTurns: 0,
        totalCost: 0,
      });

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
          if (options.abortSignal?.aborted) break;
          if (turnsExecuted >= maxTurns) break;

          turnsExecuted++;
          const msg = await this.executeSingleTurn(
            runId,
            effectiveRoom,
            target,
            options.triggerMessage,
            producedMessages,
            turnsExecuted,
            options
          );
          if (msg) {
            producedMessages.push(msg);
            totalTokens += 150;
            totalCost += 0.0005;
          }
        }
      } else if (effectiveRoom.mode === 'panel') {
        for (const inst of routing.targetInstances) {
          if (options.abortSignal?.aborted) break;
          if (turnsExecuted >= maxTurns) break;

          turnsExecuted++;
          const msg = await this.executeSingleTurn(
            runId,
            effectiveRoom,
            inst,
            options.triggerMessage,
            producedMessages,
            turnsExecuted,
            options
          );
          if (msg) {
            producedMessages.push(msg);
            totalTokens += 150;
            totalCost += 0.0005;
          }
        }
      } else if (effectiveRoom.mode === 'debate' || effectiveRoom.mode === 'round_robin') {
        for (let t = 0; t < Math.min(maxTurns, routing.targetInstances.length * 2); t++) {
          if (options.abortSignal?.aborted) break;
          const inst = routing.targetInstances[t % routing.targetInstances.length];
          if (!inst) break;

          turnsExecuted++;
          const latestContext = producedMessages[producedMessages.length - 1]?.content || options.triggerMessage;
          const msg = await this.executeSingleTurn(
            runId,
            effectiveRoom,
            inst,
            latestContext,
            producedMessages,
            turnsExecuted,
            options
          );
          if (msg) {
            producedMessages.push(msg);
            totalTokens += 150;
            totalCost += 0.0005;
          }
        }
      } else if (effectiveRoom.mode === 'coordinator') {
        const coordinator = routing.targetInstances[0];
        if (coordinator) {
          turnsExecuted++;
          const msg = await this.executeSingleTurn(
            runId,
            effectiveRoom,
            coordinator,
            `Analyze the following request and coordinate with specialist personas: ${options.triggerMessage}`,
            producedMessages,
            turnsExecuted,
            options
          );
          if (msg) producedMessages.push(msg);
        }
      }

      const finalTrace: ChatDeliveryTrace = {
        ...routing.trace,
        state: options.abortSignal?.aborted ? 'failed' : 'completed',
      };

      this.manager.eventBus.emit('run:completed', {
        runId,
        totalTurns: turnsExecuted,
        totalCost,
      });

      return {
        runId,
        roomId: effectiveRoom.id,
        status: options.abortSignal?.aborted ? 'cancelled' : 'completed',
        turnsExecuted,
        messages: producedMessages,
        tokensUsed: totalTokens,
        costUSD: totalCost,
        deliveryTrace: finalTrace,
      };
    } catch (err) {
      const errorMsg = (err as Error).message;
      this.manager.eventBus.emit('run:failed', { runId, error: errorMsg });

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
  }

  private async executeSingleTurn(
    runId: string,
    room: Room,
    instance: AgentInstance & { persona: Persona; installation: AgentInstallation },
    triggerText: string,
    history: Message[],
    turnIndex: number,
    options: OrchestrationRunOptions
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

    const abortCtrl = new AbortController();
    if (options.abortSignal) {
      options.abortSignal.addEventListener('abort', () => abortCtrl.abort());
    }

    let answerText = '';
    try {
      const execResult = await adapter.execute({
        runId,
        sessionId: `session-${instance.id}`,
        promptTree,
        workspaceDir: room.workspacePath,
        abortSignal: abortCtrl.signal,
        onChunk: (chunk) => {
          answerText += chunk;
          options.onChunk?.(instance.name, chunk);
        },
      });

      const rawContent = (execResult.content || answerText || '').trim();
      if (!rawContent) {
        throw new Error(`EMPTY_AGENT_RESPONSE: ${instance.name} produced no response.`);
      }

      const msg = await this.manager.postMessage({
        roomId: room.id,
        senderType: 'agent_instance',
        senderId: instance.id,
        senderDisplayName: `${instance.persona.avatarEmoji || '🤖'} ${instance.name}`,
        content: rawContent,
        contentType: 'text',
      });

      options.onTurnComplete?.(instance.name, msg);
      return msg;
    } catch (err) {
      const rawError = (err as Error).message;
      let sanitizedReason = 'Agent execution failed.';
      if (rawError.includes('not found') || rawError.includes('ENOENT')) {
        sanitizedReason = 'Agent binary or executable was not found.';
      } else if (rawError.includes('rejected by security policy')) {
        sanitizedReason = 'Invalid runtime argument rejected by security policy.';
      } else if (rawError.includes('timed out') || rawError.includes('aborted')) {
        sanitizedReason = 'Execution timed out or was aborted.';
      } else {
        const firstLine = rawError.split('\n')[0]?.slice(0, 120) || 'Internal runtime error';
        sanitizedReason = firstLine;
      }

      const userFacingErrorMessage = `⚠️ Agent execution failed.\nReason: ${sanitizedReason}\nRun \`agentdeck doctor ${instance.installation.definitionId}\` or inspect system logs for details.`;

      const fallbackMsg = await this.manager.postMessage({
        roomId: room.id,
        senderType: 'agent_instance',
        senderId: instance.id,
        senderDisplayName: `${instance.persona.avatarEmoji || '🤖'} ${instance.name}`,
        content: userFacingErrorMessage,
        contentType: 'text',
      });
      return fallbackMsg;
    }
  }
}

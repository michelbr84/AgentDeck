import { AgentDeckManager } from './agent-deck-manager.js';
import {
  Room,
  Message,
  AgentInstance,
  Persona,
  AgentInstallation,
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
  error?: string;
}

export class MultiAgentOrchestrationEngine {
  constructor(private manager: AgentDeckManager) {}

  /**
   * Dispatches and coordinates multi-agent conversation according to Room mode and safety guardrails.
   */
  public async executeRun(options: OrchestrationRunOptions): Promise<OrchestrationResult> {
    const runId = `run-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const roomList = await this.manager.listRooms();
    const room = roomList.find((r) => r.id === options.roomId);

    if (!room) {
      throw new Error(`Room with ID "${options.roomId}" not found`);
    }

    const mode = options.modeOverride || room.mode;
    const maxTurns = room.maxTurnsPerRun || 10;
    const allInstances = await this.manager.listAgentInstances();
    const members = await this.manager.listRoomMembers(room.id);
    const roomMemberInstanceIds = new Set(
      members.filter((m) => m.memberType === 'agent_instance').map((m) => m.memberId)
    );

    // Filter instances to only those belonging to the room (or all if none configured)
    const instances =
      roomMemberInstanceIds.size > 0
        ? allInstances.filter((i) => roomMemberInstanceIds.has(i.id))
        : allInstances;

    // 1. Post user trigger message
    const userMsg = await this.manager.postMessage({
      roomId: room.id,
      senderType: 'user',
      senderId: options.senderUserId,
      senderDisplayName: options.senderDisplayName,
      content: options.triggerMessage,
      contentType: 'text',
    });

    const producedMessages: Message[] = [userMsg];
    let turnsExecuted = 0;
    let totalTokens = 0;
    let totalCost = 0;

    this.manager.eventBus.emit('run:started', {
      runId,
      roomId: room.id,
      mode,
      activeInstances: instances.map((i) => i.id),
    });

    try {
      if (mode === 'mention') {
        // Find @mentions in triggerMessage (e.g. "@Atlas", "@Claude", "@all")
        const targetInstances = this.resolveMentionedInstances(options.triggerMessage, instances);
        for (const target of targetInstances) {
          if (options.abortSignal?.aborted) break;
          if (turnsExecuted >= maxTurns) break;

          turnsExecuted++;
          const msg = await this.executeSingleTurn(
            runId,
            room,
            target,
            options.triggerMessage,
            producedMessages,
            turnsExecuted,
            options
          );
          if (msg) {
            producedMessages.push(msg);
            totalTokens += 150; // default turn approximation
            totalCost += 0.0005;
          }
        }
      } else if (mode === 'panel') {
        // Broadcast simultaneously to all room agent instances
        for (const inst of instances) {
          if (options.abortSignal?.aborted) break;
          if (turnsExecuted >= maxTurns) break;

          turnsExecuted++;
          const msg = await this.executeSingleTurn(
            runId,
            room,
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
      } else if (mode === 'debate' || mode === 'round_robin') {
        // Structured round-robin turn taking
        for (let t = 0; t < Math.min(maxTurns, instances.length * 2); t++) {
          if (options.abortSignal?.aborted) break;
          const inst = instances[t % instances.length];
          if (!inst) break;

          turnsExecuted++;
          const latestContext = producedMessages[producedMessages.length - 1]?.content || options.triggerMessage;
          const msg = await this.executeSingleTurn(
            runId,
            room,
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
      } else if (mode === 'coordinator') {
        // Select first instance as coordinator
        const coordinator = instances[0];
        if (coordinator) {
          turnsExecuted++;
          const msg = await this.executeSingleTurn(
            runId,
            room,
            coordinator,
            `Analyze the following request and coordinate with specialist personas: ${options.triggerMessage}`,
            producedMessages,
            turnsExecuted,
            options
          );
          if (msg) producedMessages.push(msg);
        }
      }

      this.manager.eventBus.emit('run:completed', {
        runId,
        totalTurns: turnsExecuted,
        totalCost,
      });

      return {
        runId,
        roomId: room.id,
        status: options.abortSignal?.aborted ? 'cancelled' : 'completed',
        turnsExecuted,
        messages: producedMessages,
        tokensUsed: totalTokens,
        costUSD: totalCost,
      };
    } catch (err) {
      const errorMsg = (err as Error).message;
      this.manager.eventBus.emit('run:failed', { runId, error: errorMsg });

      return {
        runId,
        roomId: room.id,
        status: 'failed',
        turnsExecuted,
        messages: producedMessages,
        tokensUsed: totalTokens,
        costUSD: totalCost,
        error: errorMsg,
      };
    }
  }

  private resolveMentionedInstances(
    text: string,
    instances: Array<AgentInstance & { persona: Persona; installation: AgentInstallation }>
  ): Array<AgentInstance & { persona: Persona; installation: AgentInstallation }> {
    if (text.toLowerCase().includes('@all') || text.toLowerCase().includes('@todos')) {
      return instances;
    }

    const matches: Array<AgentInstance & { persona: Persona; installation: AgentInstallation }> = [];
    for (const inst of instances) {
      const nameTag = `@${inst.name.toLowerCase()}`;
      const personaTag = `@${inst.persona.name.toLowerCase()}`;
      const engineTag = `@${inst.installation.definitionId.toLowerCase()}`;

      if (
        text.toLowerCase().includes(nameTag) ||
        text.toLowerCase().includes(personaTag) ||
        text.toLowerCase().includes(engineTag)
      ) {
        matches.push(inst);
      }
    }

    // Default to first instance if none mentioned
    return matches.length > 0 ? matches : instances.slice(0, 1);
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

      const finalContent = execResult.content || answerText || `[${instance.name}] Acknowledged.`;
      const msg = await this.manager.postMessage({
        roomId: room.id,
        senderType: 'agent_instance',
        senderId: instance.id,
        senderDisplayName: `${instance.persona.avatarEmoji || '🤖'} ${instance.name}`,
        content: finalContent,
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
        // Strip out any multiline content / composed prompts from error string
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

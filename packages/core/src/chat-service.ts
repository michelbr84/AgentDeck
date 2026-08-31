import { AgentDeckManager, GetRoomMessagesOptions } from './agent-deck-manager.js';
import { MultiAgentOrchestrationEngine, OrchestrationResult } from './orchestration-engine.js';
import { Message, MessagePage, RoomMode } from '@agentdeck/protocol';

export interface ChatSendOptions {
  roomId: string;
  content: string;
  senderUserId?: string;
  senderDisplayName?: string;
  mode?: RoomMode;
  abortSignal?: AbortSignal;
  onTurnStart?: (instanceName: string, turnIndex: number) => void;
  onChunk?: (instanceName: string, chunk: string) => void;
  onTurnComplete?: (instanceName: string, message: Message) => void;
}

/**
 * Unified ChatService providing a single source of truth for chat messaging,
 * agent turn orchestration, and multi-agent execution across Web, TUI, and CLI.
 */
export class ChatService {
  private engine: MultiAgentOrchestrationEngine;

  constructor(private manager: AgentDeckManager) {
    this.engine = new MultiAgentOrchestrationEngine(manager);
  }

  /**
   * Retrieves messages for a room in ascending display order. The
   * positional-number form returns the newest window as a plain array; the
   * options form pages by cursor and returns a `MessagePage`.
   */
  public async getMessages(roomId: string, limit?: number): Promise<Message[]>;
  public async getMessages(roomId: string, opts: GetRoomMessagesOptions): Promise<MessagePage>;
  public async getMessages(
    roomId: string,
    opts: number | GetRoomMessagesOptions = 100
  ): Promise<Message[] | MessagePage> {
    return typeof opts === 'number'
      ? this.manager.getRoomMessages(roomId, opts)
      : this.manager.getRoomMessages(roomId, opts);
  }

  /**
   * Sends a user message into a room and triggers multi-agent orchestration.
   */
  public async send(options: ChatSendOptions): Promise<OrchestrationResult> {
    const senderUserId = options.senderUserId || 'user-default';
    const senderDisplayName = options.senderDisplayName || 'User';

    return this.engine.executeRun({
      roomId: options.roomId,
      triggerMessage: options.content,
      senderUserId,
      senderDisplayName,
      modeOverride: options.mode,
      abortSignal: options.abortSignal,
      onTurnStart: options.onTurnStart,
      onChunk: options.onChunk,
      onTurnComplete: options.onTurnComplete,
    });
  }

  /**
   * Posts a standalone message without triggering agent turns.
   */
  public async postMessageOnly(params: {
    roomId: string;
    content: string;
    senderType?: 'user' | 'agent_instance';
    senderId?: string;
    senderDisplayName?: string;
  }): Promise<Message> {
    return this.manager.postMessage({
      roomId: params.roomId,
      senderType: params.senderType || 'user',
      senderId: params.senderId || 'user-default',
      senderDisplayName: params.senderDisplayName || 'User',
      content: params.content,
    });
  }
}

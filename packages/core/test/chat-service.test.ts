import { describe, it, expect } from 'vitest';
import { AgentDeckManager } from '../src/agent-deck-manager.js';
import { ChatService } from '../src/chat-service.js';
import { AgentDeckDatabase } from '@agentdeck/database';

describe('ChatService & Zero-Agent Invariants', () => {
  it('handles room with 0 agent members by executing 0 agent turns', async () => {
    const db = new AgentDeckDatabase({ dbPath: '', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);
    const chatService = new ChatService(manager);

    const user = await manager.createOrGetLocalProfile('Test User', '🧑');
    const emptyRoom = await manager.createRoom({
      name: 'empty-test-room',
      mode: 'panel',
      memberUserIds: [user.id],
      memberInstanceIds: [], // 0 agents
    });

    const result = await chatService.send({
      roomId: emptyRoom.id,
      content: 'Hello to an empty room!',
      senderUserId: user.id,
      senderDisplayName: 'Test User',
    });

    expect(result.status).toBe('completed');
    expect(result.turnsExecuted).toBe(0);
    expect(result.messages.length).toBe(1); // Only user message
    expect(result.messages[0]?.senderType).toBe('user');
    expect(result.messages[0]?.content).toBe('Hello to an empty room!');
  });
});

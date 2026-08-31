import { describe, it, expect, beforeEach } from 'vitest';
import { AgentDeckManager } from '../src/agent-deck-manager.js';
import { AgentDeckDatabase } from '@agentdeck/database';
import type { Message, MessagePage } from '@agentdeck/protocol';

async function seedRoom(manager: AgentDeckManager, count: number): Promise<string> {
  const room = await manager.createRoom({ name: `pag-room-${count}`, mode: 'round_robin' });
  for (let i = 0; i < count; i++) {
    await manager.postMessage({
      roomId: room.id,
      senderType: 'user',
      senderId: 'user-test',
      senderDisplayName: 'Tester',
      content: `message ${i}`,
    });
  }
  return room.id;
}

describe('getRoomMessages — newest window + keyset pagination', () => {
  let db: AgentDeckDatabase;
  let manager: AgentDeckManager;

  beforeEach(async () => {
    db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    manager = AgentDeckManager.createWithDatabase(db);
  });

  it('positional form returns the NEWEST window in ascending order', async () => {
    const roomId = await seedRoom(manager, 12);
    const msgs = await manager.getRoomMessages(roomId, 5);
    expect(msgs.map((m: Message) => m.content)).toEqual([
      'message 7',
      'message 8',
      'message 9',
      'message 10',
      'message 11',
    ]);
  });

  it('pages older messages via before-cursor without gaps or duplicates', async () => {
    const roomId = await seedRoom(manager, 12);

    const seen: string[] = [];
    let page: MessagePage = await manager.getRoomMessages(roomId, { limit: 5 });
    seen.unshift(...page.items.map((m) => m.content));
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBeDefined();

    let guard = 0;
    while (page.hasMore && page.nextCursor && guard++ < 10) {
      page = await manager.getRoomMessages(roomId, { limit: 5, before: page.nextCursor });
      seen.unshift(...page.items.map((m) => m.content));
    }

    expect(page.hasMore).toBe(false);
    expect(seen).toEqual(Array.from({ length: 12 }, (_, i) => `message ${i}`));
  });

  it('pages newer messages via after-cursor', async () => {
    const roomId = await seedRoom(manager, 8);
    const first = await manager.getRoomMessages(roomId, { limit: 3 });
    // Anchor at the newest item and confirm nothing newer exists.
    const all = await manager.getRoomMessages(roomId, 100);
    expect(first.items.map((m) => m.content)).toEqual(
      all.slice(-3).map((m: Message) => m.content)
    );

    const older = await manager.getRoomMessages(roomId, { limit: 3, before: first.nextCursor });
    const newerAgain = await manager.getRoomMessages(roomId, { limit: 100, after: older.nextCursor });
    // after the tail of the older window we should see everything from the
    // older page's start onwards, minus what the cursor excludes
    expect(newerAgain.items.length).toBeGreaterThan(0);
    expect(newerAgain.items[newerAgain.items.length - 1]!.content).toBe('message 7');
  });

  it('breaks same-timestamp ties by turn_index, stable across pages', async () => {
    const room = await manager.createRoom({ name: 'tie-room', mode: 'panel' });
    // Simulate a concurrent panel run: identical created_at, distinct turn_index.
    const ts = '2026-01-01 10:00:00.000';
    for (const turn of [2, 0, 3, 1]) {
      await db.db
        .insertInto('messages')
        .values({
          id: `msg-tie-${turn}`,
          room_id: room.id,
          sender_type: 'agent_instance',
          sender_id: `agent-${turn}`,
          sender_display_name: `Agent ${turn}`,
          content: `turn ${turn}`,
          content_type: 'text',
          turn_index: turn,
          created_at: ts,
        })
        .execute();
    }

    const all = await manager.getRoomMessages(room.id, 10);
    expect(all.map((m: Message) => m.content)).toEqual(['turn 0', 'turn 1', 'turn 2', 'turn 3']);

    // Page boundary inside the tie group must not skip or duplicate.
    const pageA = await manager.getRoomMessages(room.id, { limit: 2 });
    expect(pageA.items.map((m) => m.content)).toEqual(['turn 2', 'turn 3']);
    const pageB = await manager.getRoomMessages(room.id, { limit: 2, before: pageA.nextCursor });
    expect(pageB.items.map((m) => m.content)).toEqual(['turn 0', 'turn 1']);
    expect(pageB.hasMore).toBe(false);
  });

  it('orders legacy second-granularity rows and new ms-precision rows together', async () => {
    const room = await manager.createRoom({ name: 'legacy-room', mode: 'round_robin' });
    // Legacy row written by the old CURRENT_TIMESTAMP default.
    await db.db
      .insertInto('messages')
      .values({
        id: 'msg-legacy',
        room_id: room.id,
        sender_type: 'user',
        sender_id: 'user-old',
        sender_display_name: 'Old',
        content: 'legacy',
        content_type: 'text',
        created_at: '2020-01-01 00:00:00',
      })
      .execute();

    const posted = await manager.postMessage({
      roomId: room.id,
      senderType: 'user',
      senderId: 'user-new',
      senderDisplayName: 'New',
      content: 'fresh',
    });
    expect(posted.createdAt).toMatch(/T.*Z$/);

    const msgs = await manager.getRoomMessages(room.id, 10);
    expect(msgs.map((m: Message) => m.content)).toEqual(['legacy', 'fresh']);
    // Stored timestamps normalize to ISO on the way out.
    expect(msgs[0]!.createdAt).toBe('2020-01-01T00:00:00Z');
  });

  it('rejects a malformed cursor with a 400-coded error', async () => {
    const roomId = await seedRoom(manager, 1);
    await expect(
      manager.getRoomMessages(roomId, { limit: 5, before: 'not-a-cursor' })
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CURSOR' });
  });
});

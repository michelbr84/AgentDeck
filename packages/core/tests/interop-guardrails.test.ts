import { describe, it, expect } from 'vitest';
import {
  DEFAULT_INTEROP_LIMITS,
  RateLimiter,
  capFanOut,
  checkCall,
  descend,
  type CallContext,
} from '../src/interop-guardrails.js';

const T0 = 1_700_000_000_000;

function ctx(over: Partial<CallContext> = {}): CallContext {
  return { conversationId: 'c1', callPath: ['a'], startedAt: T0, turnsUsed: 0, ...over };
}

describe('checkCall', () => {
  it('allows a first hop between room-mates', () => {
    expect(checkCall(ctx(), 'b', ['b', 'c'])).toEqual({ allowed: true });
  });

  it('breaks A→B→A by call path, not by depth', () => {
    // Depth here is 2, well under the cap of 3 — only the path check catches it.
    const v = checkCall(ctx({ callPath: ['a', 'b'] }), 'a', ['a']);
    expect(v).toMatchObject({ allowed: false, code: 'cycle_detected' });
  });

  it('stops a legal but too-long chain', () => {
    const v = checkCall(ctx({ callPath: ['a', 'b', 'c'] }), 'd', ['d']);
    expect(v).toMatchObject({ allowed: false, code: 'depth_exceeded' });
  });

  it('enforces the conversation turn budget', () => {
    const v = checkCall(
      ctx({ turnsUsed: DEFAULT_INTEROP_LIMITS.maxTurnsPerConversation }),
      'b',
      ['b']
    );
    expect(v).toMatchObject({ allowed: false, code: 'turn_budget_exhausted' });
  });

  it('stops a conversation that ran past its wall clock', () => {
    const v = checkCall(ctx(), 'b', ['b'], DEFAULT_INTEROP_LIMITS, T0 + 601_000);
    expect(v).toMatchObject({ allowed: false, code: 'conversation_timeout' });
  });

  it('refuses an agent outside the caller rooms', () => {
    const v = checkCall(ctx(), 'stranger', ['b', 'c']);
    expect(v).toMatchObject({ allowed: false, code: 'not_in_allowlist' });
  });

  it('reports the offending chain so a loop is debuggable', () => {
    const v = checkCall(ctx({ callPath: ['a', 'b', 'c'] }), 'b', ['b']);
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.message).toContain('a → b → c');
  });
});

describe('capFanOut', () => {
  it('passes a small broadcast through untouched', () => {
    expect(capFanOut(['x', 'y'])).toEqual({ targets: ['x', 'y'], dropped: 0 });
  });

  it('caps a large broadcast and reports what was dropped', () => {
    const { targets, dropped } = capFanOut(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(targets).toHaveLength(DEFAULT_INTEROP_LIMITS.maxFanOut);
    // Silent truncation would read as "delivered to everyone".
    expect(dropped).toBe(2);
  });
});

describe('RateLimiter', () => {
  it('allows up to the per-minute budget then refuses', () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < DEFAULT_INTEROP_LIMITS.ratePerMinute; i++) {
      expect(limiter.check('a', T0 + i).allowed, `call ${i}`).toBe(true);
    }
    expect(limiter.check('a', T0 + 100)).toMatchObject({
      allowed: false,
      code: 'rate_limited',
    });
  });

  it('lets the window slide', () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < DEFAULT_INTEROP_LIMITS.ratePerMinute; i++) limiter.check('a', T0);
    expect(limiter.check('a', T0 + 61_000).allowed).toBe(true);
  });

  it('budgets each caller separately', () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < DEFAULT_INTEROP_LIMITS.ratePerMinute; i++) limiter.check('a', T0);
    expect(limiter.check('b', T0).allowed).toBe(true);
  });
});

describe('descend', () => {
  it('extends the path and spends a turn', () => {
    const next = descend(ctx(), 'b');
    expect(next.callPath).toEqual(['a', 'b']);
    expect(next.turnsUsed).toBe(1);
    expect(next.conversationId).toBe('c1');
  });

  it('makes a repeat visit detectable on the next hop', () => {
    const next = descend(descend(ctx(), 'b'), 'c');
    expect(checkCall(next, 'b', ['b'])).toMatchObject({ code: 'cycle_detected' });
  });
});

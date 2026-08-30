/**
 * Limits on agent-to-agent calls.
 *
 * Two agents that can call each other will eventually call each other in a
 * loop; that is not a hypothetical, it is the default outcome without these.
 * Every limit here exists because its absence produces a specific failure:
 *
 * - No cycle check → A→B→A→B forever.
 * - No depth cap → a legal chain A→B→C→D burns four agents' context per turn.
 * - No fan-out cap → one `room_post` in a 20-member room spawns 20 calls.
 * - No allowlist → any agent can reach any other, ignoring room membership.
 * - No rate limit → a retrying client hammers the deck.
 * - No audit trail → a runaway loop is undiagnosable after the fact.
 */

export interface InteropLimits {
  /** Maximum chain length. A→B→C is depth 3. */
  maxDepth: number;
  /** Total agent turns allowed in one conversation. */
  maxTurnsPerConversation: number;
  /** Wall clock for a single agent turn. */
  turnTimeoutMs: number;
  /** Wall clock for a whole conversation. */
  conversationTimeoutMs: number;
  /** Maximum targets a single broadcast may reach. */
  maxFanOut: number;
  /** Calls per minute, per calling instance. */
  ratePerMinute: number;
}

export const DEFAULT_INTEROP_LIMITS: InteropLimits = {
  maxDepth: 3,
  maxTurnsPerConversation: 12,
  turnTimeoutMs: 120_000,
  conversationTimeoutMs: 600_000,
  maxFanOut: 4,
  ratePerMinute: 30,
};

/** Travels with every inter-agent call. */
export interface CallContext {
  conversationId: string;
  /** Ordered instance ids already in this chain. */
  callPath: string[];
  /** Idempotency key so a retrying client cannot double-post. */
  idempotencyKey?: string;
  startedAt: number;
  turnsUsed: number;
}

export type GuardVerdict =
  | { allowed: true }
  | { allowed: false; code: GuardRejectionCode; message: string };

export type GuardRejectionCode =
  | 'cycle_detected'
  | 'depth_exceeded'
  | 'turn_budget_exhausted'
  | 'conversation_timeout'
  | 'fan_out_exceeded'
  | 'not_in_allowlist'
  | 'rate_limited';

/**
 * Decides whether one agent may call another.
 *
 * Cycle detection is by **call path**, not by depth. A depth cap alone still
 * lets A→B→A run three levels deep, which is the loop it was meant to stop.
 */
export function checkCall(
  ctx: CallContext,
  targetInstanceId: string,
  allowedTargets: string[],
  limits: InteropLimits = DEFAULT_INTEROP_LIMITS,
  now: number = ctx.startedAt
): GuardVerdict {
  if (ctx.callPath.includes(targetInstanceId)) {
    return {
      allowed: false,
      code: 'cycle_detected',
      message:
        `${targetInstanceId} is already in this call chain ` +
        `(${ctx.callPath.join(' → ')}). Refusing to re-enter it.`,
    };
  }

  if (ctx.callPath.length >= limits.maxDepth) {
    return {
      allowed: false,
      code: 'depth_exceeded',
      message: `Call chain is already ${ctx.callPath.length} deep (max ${limits.maxDepth}).`,
    };
  }

  if (ctx.turnsUsed >= limits.maxTurnsPerConversation) {
    return {
      allowed: false,
      code: 'turn_budget_exhausted',
      message: `Conversation used its ${limits.maxTurnsPerConversation}-turn budget.`,
    };
  }

  if (now - ctx.startedAt > limits.conversationTimeoutMs) {
    return {
      allowed: false,
      code: 'conversation_timeout',
      message: `Conversation exceeded ${Math.round(limits.conversationTimeoutMs / 1000)}s.`,
    };
  }

  // Membership is the allowlist: an agent may reach the agents it shares a room
  // with, not every agent on the deck.
  if (!allowedTargets.includes(targetInstanceId)) {
    return {
      allowed: false,
      code: 'not_in_allowlist',
      message: `${targetInstanceId} does not share a room with the caller.`,
    };
  }

  return { allowed: true };
}

/** Caps a broadcast's reach, reporting what was dropped rather than truncating silently. */
export function capFanOut<T>(
  targets: T[],
  limits: InteropLimits = DEFAULT_INTEROP_LIMITS
): { targets: T[]; dropped: number } {
  if (targets.length <= limits.maxFanOut) return { targets, dropped: 0 };
  return {
    targets: targets.slice(0, limits.maxFanOut),
    dropped: targets.length - limits.maxFanOut,
  };
}

/** In-process token bucket, keyed by calling instance. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly limits: InteropLimits = DEFAULT_INTEROP_LIMITS) {}

  /** Records a call and reports whether it is within budget. */
  check(instanceId: string, now: number): GuardVerdict {
    const windowStart = now - 60_000;
    const recent = (this.hits.get(instanceId) ?? []).filter((t) => t > windowStart);

    if (recent.length >= this.limits.ratePerMinute) {
      this.hits.set(instanceId, recent);
      return {
        allowed: false,
        code: 'rate_limited',
        message: `${instanceId} exceeded ${this.limits.ratePerMinute} inter-agent calls/minute.`,
      };
    }

    recent.push(now);
    this.hits.set(instanceId, recent);
    return { allowed: true };
  }
}

/** Extends a call chain for the next hop. */
export function descend(ctx: CallContext, targetInstanceId: string): CallContext {
  return {
    ...ctx,
    callPath: [...ctx.callPath, targetInstanceId],
    turnsUsed: ctx.turnsUsed + 1,
  };
}

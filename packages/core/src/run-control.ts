/**
 * Run-level control primitives shared by the orchestration engine, the
 * manager's active-run registry, and (via core's public surface) the UIs.
 *
 * The two error classes travel as AbortSignal `reason`s so downstream code can
 * tell a user-initiated stop (post nothing, mark the run cancelled) from a
 * per-turn timeout (post the timeout fallback, keep the run going).
 */

export class RunAbortError extends Error {
  public readonly code = 'run_aborted' as const;
  constructor(message = 'Run aborted by user') {
    super(message);
    this.name = 'RunAbortError';
  }
}

export class TurnTimeoutError extends Error {
  public readonly code = 'turn_timeout' as const;
  constructor(message = 'Agent turn timed out') {
    super(message);
    this.name = 'TurnTimeoutError';
  }
}

export interface RunBudgetOptions {
  maxTurns: number;
  /** Run-level wall clock in ms; unset disables the deadline. */
  maxRuntimeMs?: number;
  /** Run-level cost ceiling in USD; unset disables the check. */
  maxCostUSD?: number;
}

export type BudgetVerdict =
  | { allowed: true }
  | { allowed: false; code: 'turn_budget_exhausted' | 'runtime_exceeded' | 'cost_exceeded'; message: string };

/**
 * Enforces the room's run-level caps (turns, wall clock, cost) with a
 * structured stop reason, in the mold of interop-guardrails' checkCall.
 * Modes call `check()` before every turn and `noteTurn()`/`noteCost()` after.
 */
export class RunBudget {
  private readonly startedAt = Date.now();
  public turnsExecuted = 0;
  public totalCostUSD = 0;
  public stopReason: BudgetVerdict | null = null;

  constructor(private readonly opts: RunBudgetOptions) {}

  public check(): BudgetVerdict {
    if (this.turnsExecuted >= this.opts.maxTurns) {
      return this.remember({
        allowed: false,
        code: 'turn_budget_exhausted',
        message: `Run reached its ${this.opts.maxTurns}-turn budget.`,
      });
    }
    if (this.opts.maxRuntimeMs !== undefined && Date.now() - this.startedAt > this.opts.maxRuntimeMs) {
      return this.remember({
        allowed: false,
        code: 'runtime_exceeded',
        message: `Run exceeded its ${Math.round(this.opts.maxRuntimeMs / 1000)}s runtime cap.`,
      });
    }
    if (this.opts.maxCostUSD !== undefined && this.totalCostUSD > this.opts.maxCostUSD) {
      return this.remember({
        allowed: false,
        code: 'cost_exceeded',
        message: `Run exceeded its $${this.opts.maxCostUSD} cost cap.`,
      });
    }
    return { allowed: true };
  }

  public noteTurn(): void {
    this.turnsExecuted++;
  }

  public noteCost(costUSD: number): void {
    this.totalCostUSD += costUSD;
  }

  private remember(verdict: BudgetVerdict): BudgetVerdict {
    if (!verdict.allowed && !this.stopReason) this.stopReason = verdict;
    return verdict;
  }
}

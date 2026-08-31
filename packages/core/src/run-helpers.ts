/**
 * Shared execution helpers for the orchestration modes — built once here so
 * panel, coordinator and debate do not each grow their own fan-out/synthesis.
 */

/**
 * Runs `count` workers through a bounded lane pool, returning results in
 * INDEX order regardless of completion order. Worker failures resolve to
 * null instead of rejecting the batch.
 */
export async function runWithConcurrency<T>(
  count: number,
  maxConcurrency: number,
  worker: (index: number) => Promise<T | null>
): Promise<Array<T | null>> {
  const results: Array<T | null> = new Array(count).fill(null);
  let nextIndex = 0;
  const laneCount = Math.max(1, Math.min(maxConcurrency, count));
  const lanes = Array.from({ length: laneCount }, async () => {
    while (nextIndex < count) {
      const index = nextIndex++;
      try {
        results[index] = await worker(index);
      } catch {
        results[index] = null;
      }
    }
  });
  await Promise.all(lanes);
  return results;
}

/**
 * Concurrent subprocess spawns are real CPU/memory; a panel of N agents
 * defaults to min(N, this cap) simultaneous turns.
 */
export const DEFAULT_MAX_TURN_CONCURRENCY = 4;

export interface CoordinatorSubtask {
  task: string;
  specialist?: string;
}

/**
 * Tolerant parser for a coordinator's plan. Tries, in order: a fenced JSON
 * block ({"subtasks": [...]} or a bare array), a numbered list, and finally
 * the whole text as a single subtask — the last fallback is mandatory so mock
 * adapters (and models that ignore the format ask) still delegate something.
 */
export function parseCoordinatorPlan(text: string): CoordinatorSubtask[] {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fence?.[1], text];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate.trim()) as unknown;
      const subtasks = Array.isArray(parsed)
        ? parsed
        : (parsed as { subtasks?: unknown[] } | null)?.subtasks;
      if (Array.isArray(subtasks) && subtasks.length > 0) {
        const clean = subtasks
          .map((s) =>
            typeof s === 'string'
              ? { task: s }
              : {
                  task: String((s as { task?: unknown })?.task ?? ''),
                  specialist: (s as { specialist?: unknown })?.specialist
                    ? String((s as { specialist?: unknown }).specialist)
                    : undefined,
                }
          )
          .filter((s) => s.task.trim().length > 0);
        if (clean.length > 0) return clean;
      }
    } catch {
      // not JSON — keep trying
    }
  }

  const numbered = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\d+[.)]\s+/.test(l))
    .map((l) => ({ task: l.replace(/^\d+[.)]\s+/, '') }));
  if (numbered.length >= 2) return numbered;

  return [{ task: text.trim() }];
}

/**
 * Matches a plan's `specialist` label against a member's instance name,
 * persona name, or persona role (case-insensitive, both directions), falling
 * back to round-robin so an unmatched label never drops a subtask.
 */
export function matchSpecialist<T extends { name: string; persona: { name: string; role: string } }>(
  specialist: string | undefined,
  pool: T[],
  roundRobinIndex: number
): T {
  if (specialist) {
    const needle = specialist.trim().toLowerCase();
    if (needle) {
      const match = pool.find((member) => {
        const haystacks = [member.name, member.persona.name, member.persona.role].map((h) =>
          h.toLowerCase()
        );
        return haystacks.some((h) => h.includes(needle) || needle.includes(h));
      });
      if (match) return match;
    }
  }
  return pool[roundRobinIndex % pool.length]!;
}

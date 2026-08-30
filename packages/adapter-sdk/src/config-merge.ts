/**
 * Merge-write primitives shared by every LLM-configurable adapter.
 *
 * Two properties matter and both are easy to get wrong:
 *
 * - **Merge, never overwrite.** The command is documented as re-runnable, so it
 *   must not destroy configuration the user wrote by hand. We read, set only
 *   the leaves we own, and write back.
 * - **Atomic.** Write to a sibling temp file, then rename. Writing in place
 *   truncates the user's config if the process dies mid-write.
 *
 * Note we do NOT use `writeSecureFile` here: it chmods the *parent directory*
 * to 0700, which is right for `~/.agentdeck/secrets` and wrong for `~/.claude`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { LlmRouting } from '@agentdeck/protocol';
import type { ConfigDiffEntry } from './llm-configurable.js';

/** Key under which each agent config records what AgentDeck owns. */
export const OWNERSHIP_KEY = '_agentdeck';

export interface OwnershipMarker {
  version: string;
  routingHash: string;
  appliedAt: string;
  managedKeys: string[];
}

/**
 * Stable fingerprint of a routing.
 *
 * Covers only what we write into agent configs — provider, model, base URL.
 * The credential is excluded on purpose: rotating a key must not look like a
 * routing change, and the hash is stored in plaintext config files.
 */
export function routingHash(routing: LlmRouting): string {
  const part = (b: LlmRouting['primary'] | LlmRouting['backup']): string =>
    b ? `${b.providerId}|${b.model}|${b.baseUrl ?? ''}` : '-';
  return crypto
    .createHash('sha256')
    .update(`${part(routing.primary)}::${part(routing.backup)}`)
    .digest('hex')
    .slice(0, 32);
}

export function buildOwnershipMarker(
  routing: LlmRouting,
  managedKeys: string[],
  version: string,
  now: string
): OwnershipMarker {
  return { version, routingHash: routingHash(routing), appliedAt: now, managedKeys };
}

/** Reads and parses a JSON config, returning `{}` when absent and throwing when corrupt. */
export async function readJsonConfig(file: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return {};
  }
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    // Refusing beats silently replacing a config we failed to understand.
    throw new Error(
      `${file} is not valid JSON (${(err as Error).message}); refusing to overwrite it. ` +
        'Fix or move the file and re-run.'
    );
  }
}

/**
 * Writes JSON atomically with 0600, creating parent directories as needed.
 * The parent directory's own mode is left alone.
 */
export async function writeJsonConfigAtomic(
  file: string,
  data: unknown
): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.agentdeck.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, encoding: 'utf8' });
  try {
    await fs.chmod(tmp, 0o600);
  } catch {
    // Non-POSIX filesystem.
  }
  await fs.rename(tmp, file);
  try {
    await fs.chmod(file, 0o600);
  } catch {
    // Non-POSIX filesystem.
  }
}

/** Reads a dotted path (`agents.defaults.model.primary`) out of a nested object. */
export function getPath(obj: Record<string, unknown>, dotted: string): unknown {
  let cur: unknown = obj;
  for (const seg of dotted.split('.')) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Sets a dotted path, creating intermediate objects. Mutates and returns `obj`. */
export function setPath(
  obj: Record<string, unknown>,
  dotted: string,
  value: unknown
): Record<string, unknown> {
  const segs = dotted.split('.');
  const last = segs.pop();
  if (!last) return obj;
  let cur: Record<string, unknown> = obj;
  for (const seg of segs) {
    const next = cur[seg];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      cur[seg] = {};
    }
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[last] = value;
  return obj;
}

/** Removes a dotted path if present. */
export function deletePath(obj: Record<string, unknown>, dotted: string): void {
  const segs = dotted.split('.');
  const last = segs.pop();
  if (!last) return;
  let cur: unknown = obj;
  for (const seg of segs) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return;
    cur = (cur as Record<string, unknown>)[seg];
  }
  if (cur && typeof cur === 'object') delete (cur as Record<string, unknown>)[last];
}

/**
 * Compares what we are about to write against what is there, producing a diff.
 * Credential-bearing keys are masked on both sides.
 */
export function diffKeys(
  file: string,
  before: Record<string, unknown>,
  changes: { key: string; value: string; secret?: boolean }[]
): ConfigDiffEntry[] {
  const out: ConfigDiffEntry[] = [];
  for (const change of changes) {
    const prior = getPath(before, change.key);
    const priorStr = prior === undefined || prior === null ? null : String(prior);
    if (priorStr === change.value) continue;
    out.push({
      file,
      key: change.key,
      before: change.secret ? (priorStr === null ? null : '••••') : priorStr,
      after: change.secret ? '••••' : change.value,
      redacted: change.secret === true,
    });
  }
  return out;
}

/**
 * Detects keys we manage that were hand-edited since our last write.
 *
 * Compares the marker's recorded hash against a freshly computed one over the
 * live values. Any mismatch means the user touched something, so an unforced
 * apply should stop and ask rather than silently clobber their edit.
 */
export function detectDrift(
  config: Record<string, unknown>,
  marker: OwnershipMarker | null,
  expected: { key: string; value: string }[]
): string[] {
  if (!marker) return [];
  const drifted: string[] = [];
  for (const { key, value } of expected) {
    const live = getPath(config, key);
    const liveStr = live === undefined || live === null ? null : String(live);
    if (liveStr !== null && liveStr !== value) drifted.push(key);
  }
  return drifted;
}

/** Reads our ownership marker out of a parsed config. */
export function readOwnershipMarker(
  config: Record<string, unknown>
): OwnershipMarker | null {
  const raw = config[OWNERSHIP_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<OwnershipMarker>;
  if (typeof m.routingHash !== 'string') return null;
  return {
    version: typeof m.version === 'string' ? m.version : 'unknown',
    routingHash: m.routingHash,
    appliedAt: typeof m.appliedAt === 'string' ? m.appliedAt : '',
    managedKeys: Array.isArray(m.managedKeys) ? m.managedKeys.map(String) : [],
  };
}

/**
 * Refuses to write a literal credential into a file others can read.
 *
 * A warning scrolling past in a wizard is not a control; this throws.
 */
export async function assertPrivateBeforeSecret(file: string): Promise<void> {
  let mode: number;
  try {
    mode = (await fs.stat(file)).mode & 0o777;
  } catch {
    return; // Does not exist yet; we create it 0600.
  }
  if (mode & 0o077) {
    throw new Error(
      `${file} is readable by other users (mode ${mode.toString(8)}) and would receive an ` +
        `API key. Run \`chmod 600 ${file}\` and try again.`
    );
  }
}

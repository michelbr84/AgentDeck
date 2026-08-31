/**
 * Optional capability: "this adapter can point its agent at a provider+model".
 *
 * Deliberately NOT part of `AgentAdapter`. Declarative plugins loaded from
 * `~/.agentdeck/plugins` implement the base contract and genuinely cannot
 * configure an LLM; forcing a method on them would only make them throw. A
 * separate interface plus `isLlmConfigurable()` says the same thing honestly,
 * and adds nothing to `AgentCapabilitiesSchema` — every field there is
 * `.default()`ed, so a new one becomes required in the inferred type and would
 * have to be edited into nine adapter literals.
 */
import type { BackupStrategy, KeyDelivery, LlmRouting } from '@agentdeck/protocol';
import type { AgentAdapter, BackupResult } from './index.js';

/** Static description of how far an agent can honour a routing. */
export interface LlmConfigCapabilities {
  /**
   * Whether the agent can express a fallback model itself.
   *
   * `native`      — the agent has a real fallback slot (GarraIA, OpenClaw).
   * `via-gateway` — no native slot, but it is pointed at the GarraIA gateway,
   *                 which does the failover on its behalf.
   * `none`        — no backup is possible. Say so; never write the backup model
   *                 into a field the agent treats as primary.
   */
  backupStrategy: BackupStrategy;
  supportsBackup: boolean;
  keyDelivery: KeyDelivery;
  /**
   * Files this adapter writes.
   *
   * Invariant, asserted by a test: every entry must also appear in
   * `backupConfig()`'s manifest. Writing a file that is not backed up makes
   * `rollback()` a no-op that reports success.
   */
  configFiles: string[];
}

export interface LlmConfigReadResult {
  primary: LlmRouting['primary'] | null;
  backup: LlmRouting['backup'] | null;
  /** True when our ownership marker is present in the agent's config. */
  managedByAgentDeck: boolean;
  /** Hash of the routing we last wrote, for idempotent re-runs. */
  routingHash: string | null;
  /** Managed keys the user has since hand-edited. Non-empty blocks a silent overwrite. */
  drift: string[];
  warnings: string[];
}

export interface ApplyLlmConfigOptions {
  /** Compute and return the diff without touching disk. */
  dryRun: boolean;
  /** Overwrite even when the user has hand-edited a managed key. */
  force: boolean;
  /** Resolves a `credentialRef` to the actual secret, only when about to write it. */
  resolveSecret: (ref: string) => Promise<string | null>;
  onProgress?: (stage: string) => void;
}

export interface ConfigDiffEntry {
  file: string;
  key: string;
  before: string | null;
  after: string;
  /** True when before/after were masked because the value is a credential. */
  redacted: boolean;
}

export interface ApplyLlmConfigResult {
  changed: boolean;
  /** True when the routing hash already matched — nothing was written. */
  alreadyCurrent: boolean;
  diff: ConfigDiffEntry[];
  filesWritten: string[];
  backup: BackupResult | null;
  warnings: string[];
}

export interface LlmConfigurable {
  readonly llmConfig: LlmConfigCapabilities;
  readLlmConfig(): Promise<LlmConfigReadResult>;
  applyLlmConfig(routing: LlmRouting, opts: ApplyLlmConfigOptions): Promise<ApplyLlmConfigResult>;
}

export function isLlmConfigurable(
  adapter: AgentAdapter
): adapter is AgentAdapter & LlmConfigurable {
  return typeof (adapter as Partial<LlmConfigurable>).applyLlmConfig === 'function';
}

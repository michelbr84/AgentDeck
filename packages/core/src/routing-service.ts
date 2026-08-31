/**
 * Applies one LLM routing across every managed agent.
 *
 * The whole point of the feature: the user picks a provider+model pair once,
 * and all four agents end up pointing at it. Per-agent overrides exist
 * (`ApplyOptions.overrides`) but are deliberately not the default path, and
 * they ride the same run: one backup dir, one dry-run gate, one manifest.
 *
 * The apply is two-phase and does NOT auto-revert partial success. See
 * `applyToAgents` for why.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentAdapter, ApplyLlmConfigResult, BackupResult } from '@agentdeck/adapter-sdk';
import { OWNERSHIP_KEY, isLlmConfigurable } from '@agentdeck/adapter-sdk';
import { AGENTDECK_PATHS } from '@agentdeck/shared';
import { SecretStore, ensureSecureDirectory } from '@agentdeck/security';
import type { LlmRouting } from '@agentdeck/protocol';
import type { AgentDeckDatabase } from '@agentdeck/database';

export interface AgentApplyOutcome {
  agentId: string;
  agentName: string;
  status: 'applied' | 'already-current' | 'skipped' | 'failed';
  reason?: string;
  result?: ApplyLlmConfigResult;
  backup?: BackupResult | null;
}

export interface ApplyRunReport {
  runId: string;
  backupDir: string;
  /** The deck routing — what every agent got unless it appears in `overrides`. */
  routing: LlmRouting;
  /**
   * Per-agent routings that were actually used, keyed by agent id. Only ids
   * naming a selected, configurable agent survive; the rest are dropped so the
   * report never claims an override nobody received.
   */
  overrides: Record<string, LlmRouting>;
  outcomes: AgentApplyOutcome[];
  /** True when at least one agent applied and at least one failed. */
  partial: boolean;
}

export interface RollbackOutcome {
  agentId: string;
  /** True when anything actually changed on disk. */
  restored: boolean;
  restoredFiles: string[];
  /** Files we created and therefore removed to reach the pre-run state. */
  removedFiles: string[];
  reason?: string;
}

export interface ApplyOptions {
  dryRun?: boolean;
  force?: boolean;
  /** Stable id for the backup directory. Callers pass a timestamp. */
  runId: string;
  /**
   * Per-agent routings, keyed by adapter definition id. A listed agent gets
   * that routing instead of `routing`; ids matching no selected agent are
   * ignored. Overrides share the run's backup dir and manifest.
   */
  overrides?: Record<string, LlmRouting>;
  onProgress?: (agentId: string, stage: string) => void;
}

export class RoutingService {
  private readonly secrets: SecretStore;

  constructor(
    private readonly db: AgentDeckDatabase,
    secretsDir: string = AGENTDECK_PATHS.SECRETS_DIR
  ) {
    this.secrets = new SecretStore({ secretsDir });
  }

  get secretStore(): SecretStore {
    return this.secrets;
  }

  /** Reads the deck-wide routing, or null when the user has not chosen one yet. */
  async getRouting(): Promise<LlmRouting | null> {
    const row = await this.db.db
      .selectFrom('llm_routing')
      .selectAll()
      .where('id', '=', 'default')
      .executeTakeFirst();
    if (!row) return null;
    return {
      primary: JSON.parse(row.primary_json) as LlmRouting['primary'],
      backup: row.backup_json ? (JSON.parse(row.backup_json) as LlmRouting['backup']) : undefined,
      updatedAt: row.updated_at,
    };
  }

  /** Upserts the deck-wide routing. */
  async setRouting(routing: LlmRouting): Promise<void> {
    const values = {
      id: 'default',
      primary_json: JSON.stringify(routing.primary),
      backup_json: routing.backup ? JSON.stringify(routing.backup) : null,
      updated_at: routing.updatedAt,
    };
    await this.db.db
      .insertInto('llm_routing')
      .values(values)
      .onConflict((oc) => oc.column('id').doUpdateSet(values))
      .execute();
  }

  /** Per-instance override, or null when the instance inherits the deck default. */
  async getOverride(instanceId: string): Promise<LlmRouting | null> {
    const row = await this.db.db
      .selectFrom('agent_instances')
      .select('llm_override_json')
      .where('id', '=', instanceId)
      .executeTakeFirst();
    return row?.llm_override_json ? (JSON.parse(row.llm_override_json) as LlmRouting) : null;
  }

  async setOverride(instanceId: string, routing: LlmRouting | null): Promise<void> {
    await this.db.db
      .updateTable('agent_instances')
      .set({
        llm_override_json: routing ? JSON.stringify(routing) : null,
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', instanceId)
      .execute();
  }

  /** Directory holding one run's config backups. */
  backupDirFor(runId: string): string {
    return path.join(AGENTDECK_PATHS.BACKUPS_DIR, `routing-${runId}`);
  }

  /**
   * Applies `routing` to each adapter — or, for agents named in
   * `opts.overrides`, their own routing. Everything else about the run is
   * shared: one backup dir, one dry-run gate, one manifest.
   *
   * Three phases, in order:
   *   1. Back up every selected agent's config. Abort the whole run if any
   *      backup fails — without a backup there is nothing to roll back to.
   *   2. Dry-run every agent and abort before any write if one reports a hard
   *      error (unreadable config, missing binary, world-readable target).
   *   3. Apply for real, sequentially.
   *
   * On a failure after N-1 successes we STOP and report, rather than reverting
   * the successes. A partial success is still useful, and an automatic revert
   * can itself fail and leave a worse state than it found. The explicit escape
   * hatch is `rollbackRun()`.
   */
  async applyToAgents(
    adapters: AgentAdapter[],
    routing: LlmRouting,
    opts: ApplyOptions
  ): Promise<ApplyRunReport> {
    const backupDir = this.backupDirFor(opts.runId);
    const outcomes: AgentApplyOutcome[] = [];
    const configurable = adapters.filter(isLlmConfigurable);

    for (const adapter of adapters) {
      if (!isLlmConfigurable(adapter)) {
        outcomes.push({
          agentId: adapter.definition.id,
          agentName: adapter.definition.name,
          status: 'skipped',
          reason: 'This agent does not expose an LLM configuration surface.',
        });
      }
    }

    const resolveSecret = (ref: string): Promise<string | null> => this.secrets.resolve(ref);

    // Keep only the overrides that name an agent in this run, so neither the
    // report nor the manifest mentions a routing nobody received.
    const overrides: Record<string, LlmRouting> = {};
    for (const adapter of configurable) {
      const own = opts.overrides?.[adapter.definition.id];
      if (own) overrides[adapter.definition.id] = own;
    }
    const routingFor = (adapter: AgentAdapter): LlmRouting =>
      overrides[adapter.definition.id] ?? routing;

    // Phase 1 — back up everything before touching anything.
    const backups = new Map<string, BackupResult>();
    if (!opts.dryRun) {
      await ensureSecureDirectory(AGENTDECK_PATHS.BACKUPS_DIR);
      await ensureSecureDirectory(backupDir);
      for (const adapter of configurable) {
        opts.onProgress?.(adapter.definition.id, 'backing up config');
        try {
          backups.set(
            adapter.definition.id,
            await adapter.backupConfig(path.join(backupDir, adapter.definition.id))
          );
        } catch (err) {
          throw new Error(
            `Aborting: could not back up ${adapter.definition.name} (${(err as Error).message}). ` +
              'Nothing was changed.'
          );
        }
      }
    }

    // Phase 2 — dry-run everything, so a bad config fails before any write.
    if (!opts.dryRun) {
      for (const adapter of configurable) {
        try {
          await adapter.applyLlmConfig(routingFor(adapter), {
            dryRun: true,
            force: opts.force ?? false,
            resolveSecret,
          });
        } catch (err) {
          throw new Error(
            `Aborting before any write: ${adapter.definition.name} would fail ` +
              `(${(err as Error).message}). Nothing was changed.`
          );
        }
      }
    }

    // Phase 3 — apply.
    for (const adapter of configurable) {
      const base = { agentId: adapter.definition.id, agentName: adapter.definition.name };
      try {
        const result = await adapter.applyLlmConfig(routingFor(adapter), {
          dryRun: opts.dryRun ?? false,
          force: opts.force ?? false,
          resolveSecret,
          onProgress: (stage) => opts.onProgress?.(adapter.definition.id, stage),
        });
        outcomes.push({
          ...base,
          status: result.alreadyCurrent ? 'already-current' : 'applied',
          result,
          backup: backups.get(adapter.definition.id) ?? null,
        });
      } catch (err) {
        outcomes.push({ ...base, status: 'failed', reason: (err as Error).message });
        break; // Stop at the first real failure; do not keep writing.
      }
    }

    if (!opts.dryRun && backups.size > 0) {
      await fs.writeFile(
        path.join(backupDir, 'manifest.json'),
        `${JSON.stringify(
          {
            runId: opts.runId,
            createdAt: new Date().toISOString(),
            routing,
            overrides,
            // Per agent, the routing it was actually given — so a run can be
            // read back without re-deriving who overrode what.
            agents: [...backups.entries()].map(([id, b]) => ({
              id,
              backup: b,
              routing: overrides[id] ?? routing,
            })),
          },
          null,
          2
        )}\n`,
        { mode: 0o600 }
      );
    }

    const applied = outcomes.some((o) => o.status === 'applied');
    const failed = outcomes.some((o) => o.status === 'failed');
    return { runId: opts.runId, backupDir, routing, overrides, outcomes, partial: applied && failed };
  }

  /** Lists runs that can be rolled back, newest first. */
  async listRuns(): Promise<{ runId: string; createdAt: string; backupDir: string }[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(AGENTDECK_PATHS.BACKUPS_DIR);
    } catch {
      return [];
    }
    const runs: { runId: string; createdAt: string; backupDir: string }[] = [];
    for (const entry of entries.filter((e) => e.startsWith('routing-'))) {
      const backupDir = path.join(AGENTDECK_PATHS.BACKUPS_DIR, entry);
      try {
        const manifest = JSON.parse(
          await fs.readFile(path.join(backupDir, 'manifest.json'), 'utf8')
        ) as { runId: string; createdAt: string };
        runs.push({ runId: manifest.runId, createdAt: manifest.createdAt, backupDir });
      } catch {
        // A run without a readable manifest cannot be restored; skip it.
      }
    }
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Restores the configs captured by a run.
   *
   * The explicit undo for a partial apply. Restoring one agent at a time is
   * supported because a partial apply usually only needs the failed half undone.
   */
  async rollbackRun(
    runId: string,
    adapters: AgentAdapter[],
    onlyAgentId?: string
  ): Promise<RollbackOutcome[]> {
    const backupDir = this.backupDirFor(runId);
    const manifest = JSON.parse(
      await fs.readFile(path.join(backupDir, 'manifest.json'), 'utf8')
    ) as { agents: { id: string; backup: BackupResult }[] };

    const out: RollbackOutcome[] = [];
    for (const entry of manifest.agents) {
      if (onlyAgentId && entry.id !== onlyAgentId) continue;
      const adapter = adapters.find((a) => a.definition.id === entry.id);
      if (!adapter) {
        out.push({
          agentId: entry.id,
          restored: false,
          restoredFiles: [],
          removedFiles: [],
          reason: 'adapter not registered',
        });
        continue;
      }
      try {
        await adapter.rollback(entry.backup);
        const restoredFiles = entry.backup.backedUpFiles.slice();

        // A file the backup *skipped* did not exist when we started. Truly
        // restoring that state means deleting what we created — otherwise
        // "rollback" leaves our config in place while reporting success.
        //
        // Only files we demonstrably own are removed: the path must be one this
        // adapter declares it writes, AND the file on disk must still carry our
        // ownership marker. That way a config the user created in between is
        // never deleted out from under them.
        const removedFiles: string[] = [];
        if (isLlmConfigurable(adapter)) {
          for (const file of adapter.llmConfig.configFiles) {
            const wasBackedUp = entry.backup.manifest.items.some(
              (i) => i.sourcePath === file && entry.backup.backedUpFiles.includes(i.relativePath)
            );
            if (wasBackedUp) continue;
            if (await this.isOwnedByAgentDeck(file)) {
              await fs.rm(file, { force: true });
              removedFiles.push(file);
            }
          }
        }

        out.push({
          agentId: entry.id,
          restored: restoredFiles.length > 0 || removedFiles.length > 0,
          restoredFiles,
          removedFiles,
          ...(restoredFiles.length === 0 && removedFiles.length === 0
            ? { reason: 'nothing to restore — no config existed before this run' }
            : {}),
        });
      } catch (err) {
        out.push({
          agentId: entry.id,
          restored: false,
          restoredFiles: [],
          removedFiles: [],
          reason: (err as Error).message,
        });
      }
    }
    return out;
  }

  /** True when the file carries AgentDeck's ownership marker. */
  private async isOwnedByAgentDeck(file: string): Promise<boolean> {
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
      return typeof parsed[OWNERSHIP_KEY] === 'object' && parsed[OWNERSHIP_KEY] !== null;
    } catch {
      return false;
    }
  }
}

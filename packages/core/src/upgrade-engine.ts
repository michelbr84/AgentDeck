import path from 'node:path';
import os from 'node:os';
import { AgentAdapter, BackupResult } from '@agentdeck/adapter-sdk';
import { HealthReport, HealthCheckLevel } from '@agentdeck/protocol';
import { EventBus } from './event-bus.js';

export interface UpgradePlan {
  definitionId: string;
  currentVersion: string | null;
  targetVersion: string;
  releaseNotes?: string;
  backupPath: string;
  supportedRollback: {
    config: boolean;
    binary: boolean;
  };
}

export interface UpgradeResult {
  definitionId: string;
  previousVersion: string | null;
  newVersion: string | null;
  success: boolean;
  healthReport: HealthReport;
  backupPath: string;
  rolledBack: boolean;
  error?: string;
}

export class TransactionalUpgradeEngine {
  constructor(private eventBus?: EventBus) {}

  /**
   * Constructs an upgrade plan without performing any mutations (safe for dry-runs).
   */
  public async createPlan(adapter: AgentAdapter, targetVersion?: string): Promise<UpgradePlan> {
    const detection = await adapter.detect();
    const latestInfo = await adapter.getLatestVersion();
    const resolvedTarget = targetVersion || latestInfo.latestVersion;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(os.homedir(), '.agentdeck', 'backups', adapter.definition.id, timestamp);

    return {
      definitionId: adapter.definition.id,
      currentVersion: detection.version,
      targetVersion: resolvedTarget,
      releaseNotes: latestInfo.releaseNotes,
      backupPath,
      supportedRollback: adapter.rollbackCapabilities,
    };
  }

  /**
   * Executes transactional upgrade:
   * 1. Plan & Dry-Run check
   * 2. Snapshot native configurations
   * 3. Upgrade execution
   * 4. Health check validation (Level 1 + Level 2)
   * 5. Rollback on failure if needed
   */
  public async executeUpgrade(
    adapter: AgentAdapter,
    options?: {
      targetVersion?: string;
      dryRun?: boolean;
      healthCheckLevel?: HealthCheckLevel;
      onProgress?: (stage: string, percent?: number) => void;
    }
  ): Promise<UpgradeResult> {
    const plan = await this.createPlan(adapter, options?.targetVersion);

    this.eventBus?.emit('agent:upgrade:started', {
      definitionId: adapter.definition.id,
      plan,
      dryRun: !!options?.dryRun,
    });

    if (options?.dryRun) {
      options?.onProgress?.('Dry-run completed. No system changes made.', 100);
      const currentHealth = await adapter.checkHealth('level1_static');
      return {
        definitionId: adapter.definition.id,
        previousVersion: plan.currentVersion,
        newVersion: plan.targetVersion,
        success: true,
        healthReport: currentHealth,
        backupPath: plan.backupPath,
        rolledBack: false,
      };
    }

    let backup: BackupResult = {
      backupPath: plan.backupPath,
      manifest: { agentDefinitionId: adapter.definition.id, items: [] },
      backedUpFiles: [],
      skippedFiles: [],
      timestamp: new Date().toISOString(),
    };
    let rolledBack = false;

    try {
      // Step 1: Pre-upgrade Snapshot
      options?.onProgress?.('Creating pre-upgrade configuration snapshot...', 10);
      backup = await adapter.backupConfig(plan.backupPath);

      // Step 2: Execute Upgrade
      options?.onProgress?.('Applying upgrade package...', 40);
      await adapter.upgrade({
        targetVersion: plan.targetVersion,
        onProgress: (stage, pct) => options?.onProgress?.(stage, pct),
      });

      // Step 3: Health Verification
      options?.onProgress?.('Verifying installation health...', 80);
      const healthLevel = options?.healthCheckLevel || 'level2_connectivity';
      const health = await adapter.checkHealth(healthLevel);

      if (health.overallStatus === 'unhealthy') {
        throw new Error(`Health check failed after upgrade: ${JSON.stringify(health.diagnostics)}`);
      }

      const postDetect = await adapter.detect();

      this.eventBus?.emit('agent:upgrade:completed', {
        definitionId: adapter.definition.id,
        newVersion: postDetect.version,
      });

      options?.onProgress?.('Upgrade successfully verified and completed', 100);

      return {
        definitionId: adapter.definition.id,
        previousVersion: plan.currentVersion,
        newVersion: postDetect.version,
        success: true,
        healthReport: health,
        backupPath: plan.backupPath,
        rolledBack: false,
      };
    } catch (err) {
      const errorMessage = (err as Error).message;
      options?.onProgress?.(`Upgrade failed: ${errorMessage}. Initiating rollback...`, 90);

      try {
        await adapter.rollback(backup);
        rolledBack = true;
      } catch {
        rolledBack = false;
      }

      this.eventBus?.emit('agent:upgrade:failed', {
        definitionId: adapter.definition.id,
        error: errorMessage,
        rolledBack,
      });

      const fallbackHealth = await adapter.checkHealth('level1_static');

      return {
        definitionId: adapter.definition.id,
        previousVersion: plan.currentVersion,
        newVersion: plan.currentVersion,
        success: false,
        healthReport: fallbackHealth,
        backupPath: plan.backupPath,
        rolledBack,
        error: errorMessage,
      };
    }
  }
}

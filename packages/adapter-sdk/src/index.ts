export * from './process-executor.js';

import {
  AgentDefinition,
  AgentCapabilities,
  RollbackCapabilities,
  AgentInstallationState,
  HealthReport,
  HealthCheckLevel,
  PromptCompositionTree,
  UsageMetric,
  AgentTurnRequest,
  AgentTransportKind,
  AgentStreamEvent,
} from '@agentdeck/protocol';

export interface DetectionResult {
  installed: boolean;
  binaryPath: string | null;
  version: string | null;
  state: AgentInstallationState;
}

export interface LatestVersionResult {
  latestVersion: string | null;
  releaseNotes?: string;
  downloadUrl?: string;
}

export interface ExecutionContext {
  runId: string;
  sessionId: string;
  promptTree: PromptCompositionTree;
  workspaceDir?: string;
  abortSignal: AbortSignal;
  turnRequest?: AgentTurnRequest;
  onChunk?: (chunk: string) => void;
  onToolCall?: (toolName: string, args: unknown) => void;
  onToolResult?: (toolName: string, result: unknown) => void;
  onEvent?: (event: AgentStreamEvent) => void;
}

export interface ExecutionResult {
  content: string;
  rawStdout?: string;
  rawStderr?: string;
  exitCode?: number;
  transport?: AgentTransportKind;
  diagnostics?: string[];
  error?: string;
  tokensUsed: {
    input: UsageMetric;
    output: UsageMetric;
    total: UsageMetric;
  };
  costUSD: UsageMetric;
}

export interface UpgradeOptions {
  targetVersion?: string;
  dryRun?: boolean;
  onProgress?: (stage: string, percent?: number) => void;
}

export interface BackupManifestItem {
  sourcePath: string;
  relativePath: string;
  description: string;
  required: boolean;
}

export interface BackupManifest {
  agentDefinitionId: string;
  items: BackupManifestItem[];
}

export interface BackupResult {
  backupPath: string;
  manifest: BackupManifest;
  backedUpFiles: string[];
  skippedFiles: string[];
  timestamp: string;
}

/**
 * Universal Agent Adapter Contract (v1alpha1)
 * Must be implemented by all official and third-party agent adapters.
 */
export interface AgentAdapter {
  readonly definition: AgentDefinition;
  readonly capabilities: AgentCapabilities;
  readonly rollbackCapabilities: RollbackCapabilities;

  /**
   * Level 1 Static detection of installed binary & configuration.
   */
  detect(): Promise<DetectionResult>;

  /**
   * Fetches latest official release version and notes.
   */
  getLatestVersion(): Promise<LatestVersionResult>;

  /**
   * Comprehensive health check across levels (1=static, 2=connectivity, 3=active test prompt).
   */
  checkHealth(level: HealthCheckLevel): Promise<HealthReport>;

  /**
   * Backs up native configurations to a safe snapshot path before modifications/upgrades.
   */
  backupConfig(backupDir: string): Promise<BackupResult>;

  /**
   * Installs the agent binary and initial environment.
   */
  install(options?: { onProgress?: (stage: string, percent?: number) => void }): Promise<void>;

  /**
   * Executes transactional upgrade.
   */
  upgrade(options?: UpgradeOptions): Promise<void>;

  /**
   * Executes rollback of configuration and/or binary if supported.
   */
  rollback(backup: BackupResult): Promise<void>;

  /**
   * Executes single or multi-turn agent execution with streaming output and safety bounds.
   */
  execute(context: ExecutionContext): Promise<ExecutionResult>;
}

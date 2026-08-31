import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  AgentDefinition,
  AgentCapabilities,
  RollbackCapabilities,
  HealthReport,
  HealthCheckLevel,
  DiagnosticItem,
} from '@agentdeck/protocol';
import {
  AgentAdapter,
  DetectionResult,
  LatestVersionResult,
  ExecutionContext,
  ExecutionResult,
  UpgradeOptions,
  BackupResult,
  executeSafeCommand,
  ApplyLlmConfigOptions,
  ApplyLlmConfigResult,
  ConfigDiffEntry,
  LlmConfigCapabilities,
  LlmConfigReadResult,
  LlmConfigurable,
  OWNERSHIP_KEY,
  assertPrivateBeforeSecret,
  buildOwnershipMarker,
  detectDrift,
  diffKeys,
  getPath,
  readJsonConfig,
  readOwnershipMarker,
  routingHash,
  setPath,
  writeJsonConfigAtomic,
} from '@agentdeck/adapter-sdk';
import type { LlmRouting, ProviderBinding } from '@agentdeck/protocol';
import { AGENTDECK_VERSION } from '@agentdeck/shared';
import { hermesModelRef, providerEnvVar } from './llm-shared.js';

/** Official Hermes installer (NousResearch). */
const HERMES_INSTALL_URL = 'https://hermes-agent.nousresearch.com/install.sh';

export class HermesAdapter implements AgentAdapter, LlmConfigurable {
  public readonly definition: AgentDefinition = {
    id: 'hermes',
    name: 'Hermes Agent',
    description: 'Autonomous multi-channel AI agent with tool-calling and skills ecosystem',
    version: '1.0.0',
    capabilities: {
      install: true,
      upgrade: true,
      healthCheck: true,
      backupConfig: true,
      chat: true,
      streaming: true,
      interactiveTerminal: true,
      jsonRpcProtocol: false,
      nativeSystemPrompt: false,
      promptOverlaySupported: true,
      languageInjectionSupported: true,
      modelSelection: true,
      multipleInstances: true,
      nativeIdentity: true,
      tools: true,
      mcp: false,
      workspaceIsolation: true,
      nativeMemory: true,
      skills: true,
      channels: true,
    },
    rollbackCapabilities: {
      config: true,
      binary: false,
    },
    supportedPlatforms: ['linux', 'darwin'],
    supportedArchitectures: ['x64', 'arm64'],
  };

  public get capabilities(): AgentCapabilities {
    return this.definition.capabilities;
  }

  public get rollbackCapabilities(): RollbackCapabilities {
    return this.definition.rollbackCapabilities;
  }

  private binaryPathCache: string | null = null;

  private async findBinary(): Promise<string | null> {
    if (this.binaryPathCache) {
      try {
        await fs.access(this.binaryPathCache);
        return this.binaryPathCache;
      } catch {
        this.binaryPathCache = null;
      }
    }

    const candidatePaths = [
      path.join(os.homedir(), '.local/bin/hermes'),
      path.join(os.homedir(), '.hermes/bin/hermes'),
      '/usr/local/bin/hermes',
      '/usr/bin/hermes',
    ];

    for (const p of candidatePaths) {
      try {
        await fs.access(p);
        this.binaryPathCache = p;
        return p;
      } catch {
        // continue
      }
    }

    try {
      const res = await executeSafeCommand({ command: 'which', args: ['hermes'] });
      const found = res.stdout.trim();
      if (found) {
        this.binaryPathCache = found;
        return found;
      }
    } catch {
      // not found in PATH
    }

    return null;
  }

  public async detect(): Promise<DetectionResult> {
    const binPath = await this.findBinary();
    if (!binPath) {
      return {
        installed: false,
        binaryPath: null,
        version: null,
        state: {
          availability: 'available',
          installation: 'not_installed',
          configuration: 'unconfigured',
          authentication: 'unknown',
          health: 'unknown',
          version: 'unknown',
          runtime: 'stopped',
        },
      };
    }

    let version: string | null = null;
    try {
      const out = await executeSafeCommand({ command: binPath, args: ['--version'] });
      // Output: "Hermes Agent v0.20.0 (2026.8.3)"
      const match = out.stdout.match(/v?([0-9]+\.[0-9]+\.[0-9]+)/);
      if (match && match[1]) {
        version = match[1];
      }
    } catch {
      // failed getting version
    }

    const hermesDir = path.join(os.homedir(), '.hermes');
    let hasConfig = false;
    try {
      await fs.access(hermesDir);
      hasConfig = true;
    } catch {
      hasConfig = false;
    }

    return {
      installed: true,
      binaryPath: binPath,
      version,
      state: {
        availability: 'available',
        installation: 'installed',
        configuration: hasConfig ? 'configured' : 'unconfigured',
        authentication: hasConfig ? 'authenticated' : 'unknown',
        health: 'healthy',
        version: 'current',
        runtime: 'stopped',
      },
    };
  }

  public async getLatestVersion(): Promise<LatestVersionResult> {
    // In real environment, check via git remote or repository
    return {
      latestVersion: '0.20.0',
      releaseNotes: 'Hermes Agent latest release',
    };
  }

  public async checkHealth(level: HealthCheckLevel): Promise<HealthReport> {
    const diagnostics: DiagnosticItem[] = [];
    const binPath = await this.findBinary();

    if (!binPath) {
      diagnostics.push({
        name: 'binary_present',
        status: 'fail',
        message: 'Hermes binary (hermes) not found in PATH or standard directories',
      });
      return {
        agentDefinitionId: this.definition.id,
        checkedAt: new Date().toISOString(),
        level,
        overallStatus: 'unhealthy',
        diagnostics,
      };
    }

    diagnostics.push({
      name: 'binary_present',
      status: 'pass',
      message: `Hermes binary found at ${binPath}`,
    });

    const detection = await this.detect();
    if (detection.version) {
      diagnostics.push({
        name: 'version_check',
        status: 'pass',
        message: `Version detected: ${detection.version}`,
      });
    } else {
      diagnostics.push({
        name: 'version_check',
        status: 'warn',
        message: 'Could not parse version from hermes --version',
      });
    }

    // Run hermes doctor if Level 2+
    if (level === 'level2_connectivity' || level === 'level3_active') {
      try {
        const docRes = await executeSafeCommand({
          command: binPath,
          args: ['doctor'],
          timeoutMs: 15000,
        });
        diagnostics.push({
          name: 'hermes_doctor',
          status: docRes.exitCode === 0 ? 'pass' : 'warn',
          message: docRes.stdout.trim() || 'Hermes doctor check completed',
        });
      } catch (err) {
        diagnostics.push({
          name: 'hermes_doctor',
          status: 'warn',
          message: `Failed to execute hermes doctor: ${(err as Error).message}`,
        });
      }
    }

    // Level 3 Active test
    if (level === 'level3_active') {
      try {
        const testRes = await executeSafeCommand({
          command: binPath,
          args: ['--help'],
          timeoutMs: 10000,
        });
        diagnostics.push({
          name: 'smoke_test',
          status: testRes.exitCode === 0 ? 'pass' : 'fail',
          message: 'Active CLI execution test passed',
        });
      } catch (err) {
        diagnostics.push({
          name: 'smoke_test',
          status: 'fail',
          message: `Smoke test failed: ${(err as Error).message}`,
        });
      }
    }

    const hasFail = diagnostics.some((d) => d.status === 'fail');
    const hasWarn = diagnostics.some((d) => d.status === 'warn');

    return {
      agentDefinitionId: this.definition.id,
      checkedAt: new Date().toISOString(),
      level,
      overallStatus: hasFail ? 'unhealthy' : hasWarn ? 'degraded' : 'healthy',
      diagnostics,
    };
  }

  public async backupConfig(backupDir: string): Promise<BackupResult> {
    await fs.mkdir(backupDir, { recursive: true });
    const manifest = {
      agentDefinitionId: this.definition.id,
      items: [
        {
          sourcePath: path.join(os.homedir(), '.hermes', 'config.json'),
          relativePath: 'config.json',
          description: 'Hermes configuration file',
          required: false,
        },
        {
          sourcePath: path.join(os.homedir(), '.hermes', 'skills'),
          relativePath: 'skills',
          description: 'Hermes user-defined skills directory',
          required: false,
        },
      ],
    };

    const backedUpFiles: string[] = [];
    const skippedFiles: string[] = [];

    for (const item of manifest.items) {
      try {
        await fs.access(item.sourcePath);
        const stat = await fs.stat(item.sourcePath);
        const dest = path.join(backupDir, item.relativePath);
        if (stat.isDirectory()) {
          await fs.cp(item.sourcePath, dest, { recursive: true });
        } else {
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.copyFile(item.sourcePath, dest);
        }
        backedUpFiles.push(item.relativePath);
      } catch {
        skippedFiles.push(item.relativePath);
      }
    }

    return {
      backupPath: backupDir,
      manifest,
      backedUpFiles,
      skippedFiles,
      timestamp: new Date().toISOString(),
    };
  }

  public async install(options?: { onProgress?: (stage: string, percent?: number) => void }): Promise<void> {
    // The official installer bootstraps uv, Python 3.11, Node, ripgrep and
    // ffmpeg. The previous `git clone github.com/hermes/hermes-agent` pointed
    // at a repository that does not exist — the upstream is NousResearch, and
    // a source checkout is not a working install anyway.
    options?.onProgress?.('Downloading the Hermes installer...', 20);
    await executeSafeCommand({
      command: 'sh',
      args: ['-c', `curl -fsSL ${HERMES_INSTALL_URL} | bash`],
      timeoutMs: 900000,
    });
    this.binaryPathCache = null;
    options?.onProgress?.('Installation completed', 100);
  }

  public async upgrade(options?: UpgradeOptions): Promise<void> {
    if (options?.dryRun) {
      options?.onProgress?.('Dry run: hermes update', 100);
      return;
    }
    const binPath = await this.findBinary();
    if (!binPath) {
      await this.install({ onProgress: options?.onProgress });
      return;
    }
    options?.onProgress?.('Upgrading Hermes via `hermes update`...', 50);
    await executeSafeCommand({
      command: binPath,
      args: ['update'],
      timeoutMs: 900000,
    });
    this.binaryPathCache = null;
    options?.onProgress?.('Hermes upgrade completed', 100);
  }

  public async rollback(backup: BackupResult): Promise<void> {
    for (const file of backup.backedUpFiles) {
      const src = path.join(backup.backupPath, file);
      const dest = path.join(os.homedir(), '.hermes', file);
      try {
        const stat = await fs.stat(src);
        if (stat.isDirectory()) {
          await fs.cp(src, dest, { recursive: true });
        } else {
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.copyFile(src, dest);
        }
      } catch {
        // continue
      }
    }
  }


  // ==========================================
  // LlmConfigurable
  // ==========================================

  public readonly llmConfig: LlmConfigCapabilities = {
    // Hermes selects one model at a time (`hermes model` / `/model`). It has no
    // documented fallback slot, so we say `none` rather than writing the backup
    // model somewhere it would be treated as primary.
    backupStrategy: 'none',
    supportsBackup: false,
    keyDelivery: 'env-in-config',
    configFiles: [path.join(os.homedir(), '.hermes', 'config.json')],
  };

  private get configPath(): string {
    return path.join(os.homedir(), '.hermes', 'config.json');
  }

  private managedKeys(routing: LlmRouting): { key: string; value: string; secret?: boolean }[] {
    const keys: { key: string; value: string; secret?: boolean }[] = [
      { key: 'model.primary', value: hermesModelRef(routing.primary) },
    ];
    const envVar = providerEnvVar(routing.primary.providerId);
    if (envVar && routing.primary.credentialRef) {
      keys.push({ key: `env.${envVar}`, value: '', secret: true });
    }
    return keys;
  }

  public async readLlmConfig(): Promise<LlmConfigReadResult> {
    let config: Record<string, unknown>;
    try {
      config = await readJsonConfig(this.configPath);
    } catch (err) {
      return {
        primary: null,
        backup: null,
        managedByAgentDeck: false,
        routingHash: null,
        drift: [],
        warnings: [(err as Error).message],
      };
    }
    const raw = getPath(config, 'model.primary');
    let primary: ProviderBinding | null = null;
    if (typeof raw === 'string' && raw.includes(':')) {
      const idx = raw.indexOf(':');
      primary = {
        providerId: raw.slice(0, idx) as ProviderBinding['providerId'],
        model: raw.slice(idx + 1),
      };
    }
    const marker = readOwnershipMarker(config);
    return {
      primary,
      backup: null,
      managedByAgentDeck: marker !== null,
      routingHash: marker?.routingHash ?? null,
      drift: [],
      warnings: [],
    };
  }

  public async applyLlmConfig(
    routing: LlmRouting,
    opts: ApplyLlmConfigOptions
  ): Promise<ApplyLlmConfigResult> {
    const warnings: string[] = [];
    if (routing.backup) {
      warnings.push(
        'Hermes has no fallback slot, so only the primary model was applied. ' +
          'Point Hermes at the GarraIA gateway if you want automatic failover.'
      );
    }

    const file = this.configPath;
    const config = await readJsonConfig(file);
    const marker = readOwnershipMarker(config);
    const desired = this.managedKeys(routing);

    const drift = detectDrift(
      config,
      marker,
      desired.filter((d) => !d.secret).map(({ key, value }) => ({ key, value }))
    );
    if (marker?.routingHash === routingHash(routing) && drift.length === 0) {
      return { changed: false, alreadyCurrent: true, diff: [], filesWritten: [], backup: null, warnings };
    }
    if (drift.length > 0 && !opts.force) {
      throw new Error(
        `${file} has hand-edited keys AgentDeck manages (${drift.join(', ')}). ` +
          'Re-run with --force to overwrite them.'
      );
    }

    let secret: string | null = null;
    const envVar = providerEnvVar(routing.primary.providerId);
    if (envVar && routing.primary.credentialRef) {
      secret = await opts.resolveSecret(routing.primary.credentialRef);
      if (!secret) warnings.push(`No stored credential for ${routing.primary.providerId}.`);
    }

    const diff: ConfigDiffEntry[] = diffKeys(file, config, desired);
    if (opts.dryRun) {
      return { changed: diff.length > 0, alreadyCurrent: false, diff, filesWritten: [], backup: null, warnings };
    }

    if (secret) await assertPrivateBeforeSecret(file);
    opts.onProgress?.('Writing Hermes model selection');

    setPath(config, 'model.primary', hermesModelRef(routing.primary));
    if (secret && envVar) setPath(config, `env.${envVar}`, secret);
    config[OWNERSHIP_KEY] = buildOwnershipMarker(
      routing,
      desired.map((d) => d.key),
      AGENTDECK_VERSION,
      new Date().toISOString()
    );

    await writeJsonConfigAtomic(file, config);

    const verify = await readJsonConfig(file);
    if (getPath(verify, 'model.primary') !== hermesModelRef(routing.primary)) {
      throw new Error(`Hermes config write did not take effect in ${file}`);
    }

    return { changed: true, alreadyCurrent: false, diff, filesWritten: [file], backup: null, warnings };
  }

  public async execute(context: ExecutionContext): Promise<ExecutionResult> {
    if (process.env.AGENTDECK_MOCK_EXECUTION === 'true' || process.env.NODE_ENV === 'test') {
      const promptText = context.promptTree.finalRawPrompt;
      const mock = `[Hermes Response] Processed prompt: ${promptText.slice(0, 100)}`;
      context.onChunk?.(mock);
      return {
        content: mock,
        rawStdout: mock,
        rawStderr: '',
        exitCode: 0,
        transport: 'mock',
        tokensUsed: {
          input: { source: 'estimated', value: Math.ceil(promptText.length / 4) },
          output: { source: 'estimated', value: Math.ceil(mock.length / 4) },
          total: { source: 'estimated', value: Math.ceil((promptText.length + mock.length) / 4) },
        },
        costUSD: { source: 'estimated', value: 0.001 },
      };
    }

    const binPath = await this.findBinary();
    if (!binPath) {
      throw new Error('Hermes binary (hermes) not found');
    }

    const promptText = context.promptTree.finalRawPrompt;
    let fullStdout = '';
    let fullStderr = '';

    // Hermes safe one-shot mode: -z sends a single prompt and prints ONLY final response text to stdout.
    // Default mode is 'normal': NO --yolo and NO --accept-hooks by default.
    // User can explicitly opt-in to 'trusted-hooks' (adds --accept-hooks) or 'unrestricted' (adds --yolo).
    const args: Array<string | { value: string; type: 'opaque-user-content' }> = [
      '-z',
      { value: promptText, type: 'opaque-user-content' },
    ];

    const ctx = context as unknown as Record<string, unknown>;
    const tr = context.turnRequest as unknown as Record<string, unknown> | undefined;
    const permPolicy = (ctx.permissionPolicy as string | undefined) || (tr?.permissionPolicy as string | undefined);
    const acceptHooks = ctx.acceptHooks === true || permPolicy === 'trusted-hooks';
    const unrestricted = ctx.yolo === true || ctx.dangerouslySkipPermissions === true || permPolicy === 'unrestricted';

    if (acceptHooks) {
      args.push('--accept-hooks');
    }
    if (unrestricted) {
      args.push('--yolo');
    }

    const output = await executeSafeCommand(
      {
        command: binPath,
        args,
        cwd: context.workspaceDir || process.cwd(),
        abortSignal: context.abortSignal,
        timeoutMs: 300000,
      },
      {
        onStdoutChunk: (chunk) => {
          fullStdout += chunk;
          context.onChunk?.(chunk);
        },
        onStderrChunk: (chunk) => {
          fullStderr += chunk;
        },
      }
    );

    const stdoutClean = (output.stdout || fullStdout).trim();
    const stderrClean = (output.stderr || fullStderr).trim();

    if (output.exitCode !== 0) {
      const combined = `${stderrClean} ${stdoutClean}`.toLowerCase();
      if (
        combined.includes('permission') ||
        combined.includes('approval required') ||
        combined.includes('approval') ||
        combined.includes('unapproved') ||
        combined.includes('requires confirmation')
      ) {
        throw new Error(`Hermes permission_required: Command or tool execution requires approval. Run with trusted-hooks or unrestricted policy if authorized.`);
      }
      if (
        combined.includes('hook') &&
        (combined.includes('unseen') || combined.includes('not approved') || combined.includes('prompt'))
      ) {
        throw new Error(`Hermes hook_consent_required: Unseen shell hook requires approval. Run with trusted-hooks policy if authorized.`);
      }
      throw new Error(`Hermes process failed with exit code ${output.exitCode}: ${stderrClean || stdoutClean || 'Process failed'}`);
    }

    if (!stdoutClean) {
      if (stderrClean) {
        throw new Error(`Hermes returned empty response (diagnostics: ${stderrClean})`);
      }
      throw new Error('EMPTY_AGENT_RESPONSE: Hermes produced no output.');
    }

    const estTokens = Math.ceil((promptText.length + stdoutClean.length) / 4);

    return {
      content: stdoutClean,
      rawStdout: stdoutClean,
      rawStderr: stderrClean,
      exitCode: output.exitCode,
      transport: 'cli-argv',
      tokensUsed: {
        input: { source: 'estimated', value: Math.ceil(promptText.length / 4) },
        output: { source: 'estimated', value: Math.ceil(stdoutClean.length / 4) },
        total: { source: 'estimated', value: estTokens },
      },
      costUSD: { source: 'estimated', value: (estTokens / 1000) * 0.002 },
    };
  }
}

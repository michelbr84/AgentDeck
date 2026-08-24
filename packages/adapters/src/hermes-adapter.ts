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
} from '@agentdeck/adapter-sdk';

export class HermesAdapter implements AgentAdapter {
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
    options?.onProgress?.('Cloning hermes-agent from git repository...', 30);
    const targetDir = path.join(os.homedir(), '.hermes/hermes-agent');
    await executeSafeCommand({
      command: 'git',
      args: ['clone', 'https://github.com/NousResearch/hermes-agent.git', targetDir],
      timeoutMs: 300000,
    });
    options?.onProgress?.('Installation completed', 100);
  }

  public async upgrade(options?: UpgradeOptions): Promise<void> {
    const hermesRepo = path.join(os.homedir(), '.hermes/hermes-agent');
    if (options?.dryRun) {
      options?.onProgress?.('Dry run: git fetch && git status in hermes repo', 100);
      return;
    }
    options?.onProgress?.('Pulling latest updates for Hermes...', 50);
    await executeSafeCommand({
      command: 'git',
      args: ['-C', hermesRepo, 'pull', 'origin', 'main'],
      timeoutMs: 120000,
    });
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

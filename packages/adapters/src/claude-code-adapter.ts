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

export class ClaudeCodeAdapter implements AgentAdapter {
  public readonly definition: AgentDefinition = {
    id: 'claude-code',
    name: 'Claude Code',
    description: "Anthropic's official agentic CLI for coding and software engineering",
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
      nativeIdentity: false,
      tools: true,
      mcp: true,
      workspaceIsolation: true,
      nativeMemory: true,
      skills: true,
      channels: false,
    },
    rollbackCapabilities: {
      config: true,
      binary: false,
    },
    supportedPlatforms: ['linux', 'darwin', 'win32'],
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
      path.join(os.homedir(), '.local/bin/claude'),
      '/usr/local/bin/claude',
      '/usr/bin/claude',
    ];

    for (const p of candidatePaths) {
      try {
        await fs.access(p);
        this.binaryPathCache = p;
        return p;
      } catch {
        // continue search
      }
    }

    try {
      const res = await executeSafeCommand({ command: 'which', args: ['claude'] });
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
      // Example output: "2.1.237 (Claude Code)"
      const match = out.stdout.match(/([0-9]+\.[0-9]+\.[0-9]+)/);
      if (match && match[1]) {
        version = match[1];
      }
    } catch {
      // failed getting version
    }

    // Check config / auth presence
    const claudeJson = path.join(os.homedir(), '.claude.json');
    let hasConfig = false;
    try {
      await fs.access(claudeJson);
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
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      return {
        latestVersion: '2.1.237',
        releaseNotes: 'Official Claude Code CLI release via npm registry',
      };
    }
    try {
      const res = await executeSafeCommand({ command: 'npm', args: ['view', '@anthropic-ai/claude-code', 'version'] });
      const ver = res.stdout.trim();
      return {
        latestVersion: ver || '2.1.237',
        releaseNotes: 'Official Claude Code CLI release via npm registry',
      };
    } catch {
      return {
        latestVersion: '2.1.237',
      };
    }
  }

  public async checkHealth(level: HealthCheckLevel): Promise<HealthReport> {
    const diagnostics: DiagnosticItem[] = [];
    const binPath = await this.findBinary();

    // 1. Static Check
    if (!binPath) {
      diagnostics.push({
        name: 'binary_present',
        status: 'fail',
        message: 'Claude Code binary (claude) not found in PATH or standard paths',
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
      message: `Binary located at ${binPath}`,
    });

    const detection = await this.detect();
    if (detection.version) {
      diagnostics.push({
        name: 'version_check',
        status: 'pass',
        message: `Version ${detection.version} parsed successfully`,
      });
    } else {
      diagnostics.push({
        name: 'version_check',
        status: 'warn',
        message: 'Could not extract version string from binary output',
      });
    }

    // 2. Connectivity Check (Level 2+)
    if (level === 'level2_connectivity' || level === 'level3_active') {
      const claudeJson = path.join(os.homedir(), '.claude.json');
      try {
        await fs.access(claudeJson);
        diagnostics.push({
          name: 'auth_config',
          status: 'pass',
          message: `Authentication configuration found at ${claudeJson}`,
        });
      } catch {
        diagnostics.push({
          name: 'auth_config',
          status: 'warn',
          message: 'No ~/.claude.json configuration found',
        });
      }
    }

    // 3. Active Check (Level 3)
    if (level === 'level3_active') {
      try {
        const testRes = await executeSafeCommand({
          command: binPath,
          args: ['-p', 'Respond only with: OK'],
          timeoutMs: 15000,
        });
        if (testRes.stdout.includes('OK') || testRes.exitCode === 0) {
          diagnostics.push({
            name: 'smoke_test',
            status: 'pass',
            message: 'Active smoke test execution succeeded',
          });
        } else {
          diagnostics.push({
            name: 'smoke_test',
            status: 'warn',
            message: `Active test returned non-zero or unexpected text: ${testRes.stderr || testRes.stdout}`,
          });
        }
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
          sourcePath: path.join(os.homedir(), '.claude.json'),
          relativePath: '.claude.json',
          description: 'Global Claude Code authentication and user config',
          required: false,
        },
      ],
    };

    const backedUpFiles: string[] = [];
    const skippedFiles: string[] = [];

    for (const item of manifest.items) {
      try {
        await fs.access(item.sourcePath);
        const dest = path.join(backupDir, item.relativePath);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(item.sourcePath, dest);
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
    options?.onProgress?.('Installing @anthropic-ai/claude-code via npm...', 20);
    await executeSafeCommand({
      command: 'npm',
      args: ['install', '-g', '@anthropic-ai/claude-code'],
      timeoutMs: 180000,
    });
    options?.onProgress?.('Installation completed', 100);
  }

  public async upgrade(options?: UpgradeOptions): Promise<void> {
    if (options?.dryRun) {
      options?.onProgress?.('Dry run: npm update -g @anthropic-ai/claude-code', 100);
      return;
    }
    options?.onProgress?.('Upgrading @anthropic-ai/claude-code...', 30);
    const target = options?.targetVersion ? `@anthropic-ai/claude-code@${options.targetVersion}` : '@anthropic-ai/claude-code@latest';
    await executeSafeCommand({
      command: 'npm',
      args: ['install', '-g', target],
      timeoutMs: 180000,
    });
    options?.onProgress?.('Upgrade completed', 100);
  }

  public async rollback(backup: BackupResult): Promise<void> {
    for (const file of backup.backedUpFiles) {
      const src = path.join(backup.backupPath, file);
      const dest = path.join(os.homedir(), file);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
    }
  }

  public async execute(context: ExecutionContext): Promise<ExecutionResult> {
    if (process.env.AGENTDECK_MOCK_EXECUTION === 'true' || process.env.NODE_ENV === 'test') {
      const promptText = context.promptTree.finalRawPrompt;
      const mock = `[Claude Code Response] Processed prompt: ${promptText.slice(0, 100)}`;
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
      throw new Error('Claude Code binary (claude) not found');
    }

    const promptText = context.promptTree.finalRawPrompt;
    const args: Array<string | { value: string; type: 'opaque-user-content' }> = [
      '-p',
      { value: promptText, type: 'opaque-user-content' },
    ];

    // Explicit opt-in permission policy bypass: only pass --dangerously-skip-permissions
    // if permissionPolicy is explicitly 'unrestricted' or dangerouslySkipPermissions flag is set
    const ctx = context as unknown as Record<string, unknown>;
    const tr = context.turnRequest as unknown as Record<string, unknown> | undefined;
    const permPolicy = (ctx.permissionPolicy as string | undefined) || (tr?.permissionPolicy as string | undefined);
    const explicitBypass = ctx.dangerouslySkipPermissions === true || permPolicy === 'unrestricted';
    if (explicitBypass) {
      args.push('--dangerously-skip-permissions');
    }

    let fullStdout = '';
    let fullStderr = '';
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

    // Strict exit code & error classification
    if (output.exitCode !== 0) {
      const combined = `${stderrClean} ${stdoutClean}`.toLowerCase();
      if (
        combined.includes('credit') ||
        combined.includes('quota') ||
        combined.includes('exhaust') ||
        combined.includes('billing') ||
        combined.includes('payment') ||
        combined.includes('plans & billing') ||
        combined.includes('balance')
      ) {
        throw new Error(`Claude Code error: Anthropic API usage credits or quota exhausted. Details: ${stderrClean || stdoutClean}`);
      }
      if (combined.includes('unauthorized') || combined.includes('login') || combined.includes('auth')) {
        throw new Error(`Claude Code authentication failed. Please run \`claude login\`. Details: ${stderrClean || stdoutClean}`);
      }
      throw new Error(`Claude Code process failed with exit code ${output.exitCode}: ${stderrClean || stdoutClean || 'Process failed'}`);
    }

    if (!stdoutClean) {
      if (stderrClean) {
        throw new Error(`Claude Code returned empty response (diagnostics: ${stderrClean})`);
      }
      throw new Error('EMPTY_AGENT_RESPONSE: Claude Code produced no output.');
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
      costUSD: { source: 'estimated', value: (estTokens / 1000) * 0.003 },
    };
  }
}

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

export class KiloAdapter implements AgentAdapter {
  public readonly definition: AgentDefinition = {
    id: 'kilo',
    name: 'Kilo Code',
    description: 'Autonomous multi-file refactoring and engineering CLI agent',
    version: '1.0.0',
    capabilities: {
      install: true,
      upgrade: true,
      healthCheck: true,
      backupConfig: true,
      chat: true,
      streaming: true,
      interactiveTerminal: true,
      jsonRpcProtocol: true,
      nativeSystemPrompt: true,
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
      path.join(os.homedir(), '.local/bin/kilo'),
      '/usr/local/bin/kilo',
      '/usr/bin/kilo',
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
      const res = await executeSafeCommand({ command: 'which', args: ['kilo'] });
      const found = res.stdout.trim();
      if (found) {
        this.binaryPathCache = found;
        return found;
      }
    } catch {
      // not in PATH
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
      const match = out.stdout.match(/([0-9]+\.[0-9]+\.[0-9]+)/);
      if (match && match[1]) {
        version = match[1];
      }
    } catch {
      // ignore
    }

    const configPath = path.join(os.homedir(), '.kilo/config.json');
    let hasConfig = false;
    try {
      await fs.access(configPath);
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
        latestVersion: '0.9.4',
        releaseNotes: 'Kilo Code CLI release',
      };
    }
    try {
      const res = await executeSafeCommand({ command: 'npm', args: ['view', '@kilocode/cli', 'version'] });
      return {
        latestVersion: res.stdout.trim() || '0.9.4',
        releaseNotes: 'Kilo Code CLI release',
      };
    } catch {
      return { latestVersion: '0.9.4' };
    }
  }

  public async checkHealth(level: HealthCheckLevel): Promise<HealthReport> {
    const diagnostics: DiagnosticItem[] = [];
    const binPath = await this.findBinary();

    if (!binPath) {
      diagnostics.push({
        name: 'binary_present',
        status: 'fail',
        message: 'Kilo binary not found',
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

    if (level === 'level2_connectivity' || level === 'level3_active') {
      const configPath = path.join(os.homedir(), '.kilo/config.json');
      try {
        await fs.access(configPath);
        diagnostics.push({
          name: 'auth_config',
          status: 'pass',
          message: `Configuration located at ${configPath}`,
        });
      } catch {
        diagnostics.push({
          name: 'auth_config',
          status: 'warn',
          message: 'No ~/.kilo/config.json found',
        });
      }
    }

    return {
      agentDefinitionId: this.definition.id,
      checkedAt: new Date().toISOString(),
      level,
      overallStatus: 'healthy',
      diagnostics,
    };
  }

  public async backupConfig(backupDir: string): Promise<BackupResult> {
    await fs.mkdir(backupDir, { recursive: true });
    const manifest = {
      agentDefinitionId: this.definition.id,
      items: [
        {
          sourcePath: path.join(os.homedir(), '.kilo/config.json'),
          relativePath: '.kilo/config.json',
          description: 'Kilo Code user and workspace config',
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
    options?.onProgress?.('Installing @kilocode/cli...', 25);
    await executeSafeCommand({
      command: 'npm',
      args: ['install', '-g', '@kilocode/cli'],
      timeoutMs: 180000,
    });
    options?.onProgress?.('Kilo Code installed', 100);
  }

  public async upgrade(options?: UpgradeOptions): Promise<void> {
    if (options?.dryRun) {
      options?.onProgress?.('Dry run: npm install -g @kilocode/cli@latest', 100);
      return;
    }
    options?.onProgress?.('Upgrading Kilo Code...', 40);
    await executeSafeCommand({
      command: 'npm',
      args: ['install', '-g', '@kilocode/cli@latest'],
      timeoutMs: 180000,
    });
    options?.onProgress?.('Kilo Code upgrade completed', 100);
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
      const mockResponse = `[Kilo Code] Codebase refactor plan for: "${promptText.slice(0, 80)}..."\nApplied changes to context.`;
      context.onChunk?.(mockResponse);
      return {
        content: mockResponse,
        rawStdout: mockResponse,
        rawStderr: '',
        exitCode: 0,
        transport: 'mock',
        tokensUsed: {
          input: { source: 'estimated', value: Math.ceil(promptText.length / 4) },
          output: { source: 'estimated', value: Math.ceil(mockResponse.length / 4) },
          total: { source: 'estimated', value: Math.ceil((promptText.length + mockResponse.length) / 4) },
        },
        costUSD: { source: 'estimated', value: 0.001 },
      };
    }

    const binPath = await this.findBinary();
    const promptText = context.promptTree.finalRawPrompt;

    if (!binPath) {
      throw new Error('Kilo Code binary (kilo) not found. Install it or deactivate this instance.');
    }

    const output = await executeSafeCommand({
      command: binPath,
      args: ['run', '--prompt', { value: promptText, type: 'opaque-user-content' }],
      cwd: context.workspaceDir || process.cwd(),
      abortSignal: context.abortSignal,
    });

    const stdoutClean = output.stdout.trim();
    const stderrClean = output.stderr.trim();

    if (output.exitCode !== 0) {
      throw new Error(`Kilo Code process failed with exit code ${output.exitCode}: ${stderrClean || stdoutClean || 'Process failed'}`);
    }

    if (!stdoutClean) {
      if (stderrClean) {
        throw new Error(`Kilo Code returned empty response (diagnostics: ${stderrClean})`);
      }
      throw new Error('EMPTY_AGENT_RESPONSE: Kilo Code produced no output.');
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

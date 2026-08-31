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
import { fetchLatestNpmVersion } from './agent-paths.js';

export class PiAdapter implements AgentAdapter {
  public readonly definition: AgentDefinition = {
    id: 'pi',
    name: 'Inflection Pi / Pi Assistant',
    description: 'Empathetic, conversation-first intelligent assistant and CLI wrapper',
    version: '1.0.0',
    capabilities: {
      install: true,
      upgrade: true,
      healthCheck: true,
      backupConfig: true,
      chat: true,
      streaming: true,
      interactiveTerminal: false,
      jsonRpcProtocol: false,
      nativeSystemPrompt: false,
      promptOverlaySupported: true,
      languageInjectionSupported: true,
      modelSelection: false,
      multipleInstances: true,
      nativeIdentity: true,
      tools: false,
      mcp: false,
      workspaceIsolation: false,
      nativeMemory: true,
      skills: false,
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
      path.join(os.homedir(), '.local/bin/pi'),
      '/usr/local/bin/pi',
      '/usr/bin/pi',
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
      const res = await executeSafeCommand({ command: 'which', args: ['pi'] });
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

    const configPath = path.join(os.homedir(), '.config/pi/config.json');
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
        latestVersion: '1.2.0',
        releaseNotes: 'Pi CLI adapter integration',
      };
    }
    // `null` means "could not determine", never a remembered constant: the
    // manager treats it as unknown (short retry TTL, never "outdated"), while a
    // pinned value would show a stale "latest" and a false outdated/up-to-date.
    const latestVersion = await fetchLatestNpmVersion('@mariozechner/pi-coding-agent');
    if (!latestVersion) {
      return {
        latestVersion: null,
        releaseNotes: 'Could not reach the npm registry; latest version unknown.',
      };
    }
    return {
      latestVersion,
      releaseNotes: 'Pi CLI adapter integration',
    };
  }

  public async checkHealth(level: HealthCheckLevel): Promise<HealthReport> {
    const diagnostics: DiagnosticItem[] = [];
    const binPath = await this.findBinary();

    if (!binPath) {
      diagnostics.push({
        name: 'binary_present',
        status: 'fail',
        message: 'Pi CLI binary not found',
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
      const configPath = path.join(os.homedir(), '.config/pi/config.json');
      try {
        await fs.access(configPath);
        diagnostics.push({
          name: 'auth_config',
          status: 'pass',
          message: `Config file present at ${configPath}`,
        });
      } catch {
        diagnostics.push({
          name: 'auth_config',
          status: 'warn',
          message: 'No Pi configuration found',
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
          sourcePath: path.join(os.homedir(), '.config/pi/config.json'),
          relativePath: '.config/pi/config.json',
          description: 'Pi assistant configuration and session state',
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
    options?.onProgress?.('Installing Pi CLI...', 30);
    await executeSafeCommand({
      command: 'npm',
      args: ['install', '-g', '@mariozechner/pi-coding-agent'],
      timeoutMs: 180000,
    });
    options?.onProgress?.('Pi CLI installed', 100);
  }

  public async upgrade(options?: UpgradeOptions): Promise<void> {
    if (options?.dryRun) {
      options?.onProgress?.('Dry run: npm install -g @mariozechner/pi-coding-agent@latest', 100);
      return;
    }
    options?.onProgress?.('Upgrading Pi CLI...', 50);
    await executeSafeCommand({
      command: 'npm',
      args: ['install', '-g', '@mariozechner/pi-coding-agent@latest'],
      timeoutMs: 180000,
    });
    options?.onProgress?.('Pi upgrade complete', 100);
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
      const mockResponse = `[Pi Assistant] Received: "${promptText.slice(0, 80)}..."\nI am ready to help you collaboratively!`;
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
        costUSD: { source: 'estimated', value: 0.0005 },
      };
    }

    const binPath = await this.findBinary();
    const promptText = context.promptTree.finalRawPrompt;

    if (!binPath) {
      throw new Error('Pi binary (pi) not found. Install it or deactivate this instance.');
    }

    const output = await executeSafeCommand({
      command: binPath,
      args: ['--prompt', { value: promptText, type: 'opaque-user-content' }],
      cwd: context.workspaceDir || process.cwd(),
      abortSignal: context.abortSignal,
    });

    const stdoutClean = output.stdout.trim();
    const stderrClean = output.stderr.trim();

    if (output.exitCode !== 0) {
      throw new Error(`Pi CLI process failed with exit code ${output.exitCode}: ${stderrClean || stdoutClean || 'Process failed'}`);
    }

    if (!stdoutClean) {
      if (stderrClean) {
        throw new Error(`Pi CLI returned empty response (diagnostics: ${stderrClean})`);
      }
      throw new Error('EMPTY_AGENT_RESPONSE: Pi CLI produced no output.');
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

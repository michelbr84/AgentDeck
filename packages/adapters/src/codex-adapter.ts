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

export class CodexAdapter implements AgentAdapter {
  public readonly definition: AgentDefinition = {
    id: 'codex',
    name: 'OpenAI Codex',
    description: 'Autonomous code generation, reasoning, and system synthesis agent powered by OpenAI models',
    version: '1.0.0',
    capabilities: {
      install: true,
      upgrade: true,
      healthCheck: true,
      backupConfig: true,
      chat: true,
      streaming: true,
      interactiveTerminal: false,
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
      path.join(os.homedir(), '.local/bin/codex'),
      '/usr/local/bin/codex',
      '/usr/bin/codex',
      path.join(os.homedir(), '.npm-global/bin/codex'),
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
      const res = await executeSafeCommand({ command: 'which', args: ['codex'] });
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

    const hasKey = !!(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY);

    return {
      installed: true,
      binaryPath: binPath,
      version,
      state: {
        availability: 'available',
        installation: 'installed',
        configuration: hasKey ? 'configured' : 'unconfigured',
        authentication: hasKey ? 'authenticated' : 'unknown',
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
        releaseNotes: 'Official OpenAI Codex CLI agent release',
      };
    }
    // `null` means "could not determine", never a remembered constant: the
    // manager treats it as unknown (short retry TTL, never "outdated"), while a
    // pinned value would show a stale "latest" and a false outdated/up-to-date.
    const latestVersion = await fetchLatestNpmVersion('@openai/codex');
    if (!latestVersion) {
      return {
        latestVersion: null,
        releaseNotes: 'Could not reach the npm registry; latest version unknown.',
      };
    }
    return {
      latestVersion,
      releaseNotes: 'Official OpenAI Codex CLI agent release',
    };
  }

  public async checkHealth(level: HealthCheckLevel): Promise<HealthReport> {
    const diagnostics: DiagnosticItem[] = [];
    const binPath = await this.findBinary();

    if (!binPath) {
      diagnostics.push({
        name: 'binary_present',
        status: 'fail',
        message: 'OpenAI Codex binary (codex) not found in PATH or ~/.local/bin',
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
      message: `OpenAI Codex binary located at ${binPath}`,
    });

    if (level === 'level2_connectivity' || level === 'level3_active') {
      const hasKey = !!(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY);
      diagnostics.push({
        name: 'auth_config',
        status: hasKey ? 'pass' : 'warn',
        message: hasKey ? 'OPENAI_API_KEY / CODEX_API_KEY detected' : 'OPENAI_API_KEY not configured in environment',
      });
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
          sourcePath: path.join(os.homedir(), '.codex/config.json'),
          relativePath: '.codex/config.json',
          description: 'OpenAI Codex configuration and profile settings',
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
    options?.onProgress?.('Installing OpenAI Codex CLI via npm...', 30);
    await executeSafeCommand({
      command: 'npm',
      args: ['install', '-g', '@openai/codex'],
      timeoutMs: 180000,
    });
    options?.onProgress?.('OpenAI Codex CLI installed successfully', 100);
  }

  public async upgrade(options?: UpgradeOptions): Promise<void> {
    if (options?.dryRun) {
      options?.onProgress?.('Dry run: npm install -g @openai/codex@latest', 100);
      return;
    }
    options?.onProgress?.('Upgrading OpenAI Codex CLI...', 50);
    await executeSafeCommand({
      command: 'npm',
      args: ['install', '-g', '@openai/codex@latest'],
      timeoutMs: 180000,
    });
    options?.onProgress?.('OpenAI Codex upgrade complete', 100);
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
      const mockResponse = `[OpenAI Codex] Synthesized code and system execution for: "${promptText.slice(0, 80)}..."\nArchitecture verified against OpenAI model specs.`;
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
        costUSD: { source: 'estimated', value: 0.002 },
      };
    }

    const binPath = await this.findBinary();
    const promptText = context.promptTree.finalRawPrompt;

    if (!binPath) {
      throw new Error('Codex binary (codex) not found. Install it or deactivate this instance.');
    }

    let fullStdout = '';
    let fullStderr = '';
    const output = await executeSafeCommand(
      {
        command: binPath,
        args: ['exec', '--prompt', { value: promptText, type: 'opaque-user-content' }],
        cwd: context.workspaceDir || process.cwd(),
        abortSignal: context.abortSignal,
        timeoutMs: context.turnRequest?.timeoutMs ?? 300000,
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
      throw new Error(`OpenAI Codex process failed with exit code ${output.exitCode}: ${stderrClean || stdoutClean || 'Process failed'}`);
    }

    if (!stdoutClean) {
      if (stderrClean) {
        throw new Error(`OpenAI Codex returned empty response (diagnostics: ${stderrClean})`);
      }
      throw new Error('EMPTY_AGENT_RESPONSE: OpenAI Codex produced no output.');
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

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

export class OpenClawAdapter implements AgentAdapter {
  public readonly definition: AgentDefinition = {
    id: 'openclaw',
    name: 'OpenClaw',
    description: 'Multi-channel autonomous workspace & assistant platform',
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
      nativeIdentity: true,
      tools: true,
      mcp: true,
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
      path.join(os.homedir(), '.local/bin/openclaw'),
      path.join(os.homedir(), '.hermes/node/lib/node_modules/openclaw/openclaw.mjs'),
      path.join(os.homedir(), 'Documents/Projetos/openclaw/openclaw.mjs'),
      '/usr/local/bin/openclaw',
      '/usr/bin/openclaw',
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
      const res = await executeSafeCommand({ command: 'which', args: ['openclaw'] });
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
      const isMjs = binPath.endsWith('.mjs') || binPath.endsWith('.js');
      const cmd = isMjs ? 'node' : binPath;
      const args = isMjs ? [binPath, '--version'] : ['--version'];

      const out = await executeSafeCommand({ command: cmd, args });
      // Output: "2026.7.1-2" or similar
      const match = out.stdout.match(/([0-9]+\.[0-9]+\.[0-9]+[a-zA-Z0-9.-]*)/);
      if (match && match[1]) {
        version = match[1];
      }
    } catch {
      // failed getting version
    }

    const configPath = path.join(os.homedir(), '.openclaw/openclaw.json');
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
    return {
      latestVersion: '2026.7.1-2',
      releaseNotes: 'OpenClaw Multi-Channel Release',
    };
  }

  public async checkHealth(level: HealthCheckLevel): Promise<HealthReport> {
    const diagnostics: DiagnosticItem[] = [];
    const binPath = await this.findBinary();

    if (!binPath) {
      diagnostics.push({
        name: 'binary_present',
        status: 'fail',
        message: 'OpenClaw entry point or executable not found',
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
      message: `OpenClaw located at ${binPath}`,
    });

    const detection = await this.detect();
    if (detection.version) {
      diagnostics.push({
        name: 'version_check',
        status: 'pass',
        message: `Version parsed: ${detection.version}`,
      });
    }

    if (level === 'level2_connectivity' || level === 'level3_active') {
      const configPath = path.join(os.homedir(), '.openclaw/openclaw.json');
      try {
        await fs.access(configPath);
        diagnostics.push({
          name: 'configuration_file',
          status: 'pass',
          message: `Configuration located at ${configPath}`,
        });
      } catch {
        diagnostics.push({
          name: 'configuration_file',
          status: 'warn',
          message: 'No ~/.openclaw/openclaw.json found',
        });
      }
    }

    if (level === 'level3_active') {
      try {
        const isMjs = binPath.endsWith('.mjs') || binPath.endsWith('.js');
        const cmd = isMjs ? 'node' : binPath;
        const args = isMjs ? [binPath, '--help'] : ['--help'];

        const res = await executeSafeCommand({ command: cmd, args, timeoutMs: 10000 });
        diagnostics.push({
          name: 'smoke_test',
          status: res.exitCode === 0 ? 'pass' : 'fail',
          message: 'Active smoke test execution completed',
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
          sourcePath: path.join(os.homedir(), '.openclaw', 'openclaw.json'),
          relativePath: 'openclaw.json',
          description: 'OpenClaw main settings and channel configurations',
          required: false,
        },
        {
          sourcePath: path.join(os.homedir(), '.openclaw', 'identities'),
          relativePath: 'identities',
          description: 'OpenClaw custom agent identities and avatars',
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
    options?.onProgress?.('Installing openclaw via npm...', 30);
    await executeSafeCommand({
      command: 'npm',
      args: ['install', '-g', 'openclaw'],
      timeoutMs: 180000,
    });
    options?.onProgress?.('Installation completed', 100);
  }

  public async upgrade(options?: UpgradeOptions): Promise<void> {
    if (options?.dryRun) {
      options?.onProgress?.('Dry run: npm update -g openclaw', 100);
      return;
    }
    options?.onProgress?.('Upgrading openclaw...', 50);
    await executeSafeCommand({
      command: 'npm',
      args: ['install', '-g', 'openclaw@latest'],
      timeoutMs: 180000,
    });
    options?.onProgress?.('OpenClaw upgrade completed', 100);
  }

  public async rollback(backup: BackupResult): Promise<void> {
    for (const file of backup.backedUpFiles) {
      const src = path.join(backup.backupPath, file);
      const dest = path.join(os.homedir(), '.openclaw', file);
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
      const mock = `[OpenClaw Response] Processed prompt: ${promptText.slice(0, 100)}`;
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
      throw new Error('OpenClaw binary (openclaw) not found');
    }

    const isMjs = binPath.endsWith('.mjs') || binPath.endsWith('.js');
    const cmd = isMjs ? 'node' : binPath;
    const promptText = context.promptTree.finalRawPrompt;
    // OpenClaw CLI contract: `agent --local --message "<prompt>" --json` or `agent --local -m "<prompt>"`
    const args: Array<string | { value: string; type: 'opaque-user-content' }> = isMjs
      ? [binPath, 'agent', '--local', '--json', '--message', { value: promptText, type: 'opaque-user-content' }]
      : ['agent', '--local', '--json', '--message', { value: promptText, type: 'opaque-user-content' }];

    let fullStdout = '';
    let fullStderr = '';
    const output = await executeSafeCommand(
      {
        command: cmd,
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
        combined.includes('no model') ||
        combined.includes('api key') ||
        combined.includes('provider') ||
        combined.includes('unconfigured') ||
        combined.includes('auth') ||
        combined.includes('credentials')
      ) {
        throw new Error(`OpenClaw error: Model provider configuration required. Details: ${stderrClean || stdoutClean}`);
      }
      throw new Error(`OpenClaw process failed with exit code ${output.exitCode}: ${stderrClean || stdoutClean || 'Process failed'}`);
    }

    let parsedContent = '';
    try {
      const jsonRes = JSON.parse(stdoutClean);
      // OpenClaw json response envelope: { reply, message, text, content, response }
      parsedContent = jsonRes.reply || jsonRes.message || jsonRes.text || jsonRes.content || jsonRes.response || (typeof jsonRes === 'string' ? jsonRes : '');
    } catch {
      parsedContent = stdoutClean;
    }

    if (!parsedContent && !stdoutClean) {
      if (stderrClean) {
        throw new Error(`OpenClaw returned empty response (diagnostics: ${stderrClean})`);
      }
      throw new Error('EMPTY_AGENT_RESPONSE: OpenClaw produced no output.');
    }

    const finalContent = parsedContent || stdoutClean;
    const estTokens = Math.ceil((promptText.length + finalContent.length) / 4);

    return {
      content: finalContent,
      rawStdout: stdoutClean,
      rawStderr: stderrClean,
      exitCode: output.exitCode,
      transport: 'cli-argv',
      tokensUsed: {
        input: { source: 'estimated', value: Math.ceil(promptText.length / 4) },
        output: { source: 'estimated', value: Math.ceil(finalContent.length / 4) },
        total: { source: 'estimated', value: estTokens },
      },
      costUSD: { source: 'estimated', value: (estTokens / 1000) * 0.002 },
    };
  }
}

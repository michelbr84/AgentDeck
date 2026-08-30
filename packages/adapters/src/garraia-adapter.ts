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
import {
  fetchLatestGithubRelease,
  parseSemver,
  pathExists,
  resolveGarraiaConfigDir,
} from './agent-paths.js';

/** Repo that publishes the `garraia-<os>-<arch>` release assets. */
const GARRAIA_REPO = 'michelbr84/GarraRUST';

export class GarraIAAdapter implements AgentAdapter {
  public readonly definition: AgentDefinition = {
    id: 'garraia',
    name: 'GarraIA',
    description: 'High-performance Rust/Node universal multi-channel agent framework and gateway',
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
      path.join(os.homedir(), '.local/bin/garraia'),
      path.join(os.homedir(), '.local/bin/garra'),
      path.join(os.homedir(), '.cargo/bin/garraia'),
      path.join(os.homedir(), '.cargo/bin/garra'),
      '/usr/local/bin/garraia',
      '/usr/local/bin/garra',
      '/usr/bin/garraia',
      '/usr/bin/garra',
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

    for (const binName of ['garraia', 'garra']) {
      try {
        const res = await executeSafeCommand({ command: 'which', args: [binName] });
        const found = res.stdout.trim();
        if (found) {
          this.binaryPathCache = found;
          return found;
        }
      } catch {
        // not in PATH
      }
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
      // Output: "garra 0.3.4"
      version = parseSemver(out.stdout);
    } catch {
      // failed getting version
    }

    // GARRAIA_CONFIG_DIR > $XDG_CONFIG_HOME/garraia > ~/.garraia, matching the
    // Rust loader. Checking ~/.garraia alone reported "unconfigured" for every
    // install that had migrated to XDG.
    const configDir = await resolveGarraiaConfigDir();
    const hasConfig = await pathExists(configDir);

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
    const release = await fetchLatestGithubRelease(GARRAIA_REPO);
    if (release) {
      return {
        latestVersion: release.version,
        releaseNotes: release.notes,
        downloadUrl: release.htmlUrl,
      };
    }
    // Offline or rate-limited. Report the installed version so the caller sees
    // "current" rather than being pushed into an upgrade that cannot run.
    const detection = await this.detect();
    return {
      latestVersion: detection.version ?? 'unknown',
      releaseNotes: 'Could not reach the GitHub releases API; version check skipped.',
    };
  }

  public async checkHealth(level: HealthCheckLevel): Promise<HealthReport> {
    const diagnostics: DiagnosticItem[] = [];
    const binPath = await this.findBinary();

    if (!binPath) {
      diagnostics.push({
        name: 'binary_present',
        status: 'fail',
        message: 'GarraIA binary (garraia) not found',
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
      message: `GarraIA binary found at ${binPath}`,
    });

    const detection = await this.detect();
    if (detection.version) {
      diagnostics.push({
        name: 'version_check',
        status: 'pass',
        message: `Version detected: ${detection.version}`,
      });
    }

    if (level === 'level2_connectivity' || level === 'level3_active') {
      const configDir = await resolveGarraiaConfigDir();
      if (await pathExists(configDir)) {
        diagnostics.push({
          name: 'configuration_directory',
          status: 'pass',
          message: `Configuration located at ${configDir}`,
        });
      } else {
        diagnostics.push({
          name: 'configuration_directory',
          status: 'warn',
          message: `No GarraIA config directory found (looked at ${configDir})`,
        });
      }
    }

    if (level === 'level3_active') {
      try {
        const res = await executeSafeCommand({ command: binPath, args: ['--help'], timeoutMs: 10000 });
        diagnostics.push({
          name: 'smoke_test',
          status: res.exitCode === 0 ? 'pass' : 'fail',
          message: 'Active smoke test execution passed',
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
    const configDir = await resolveGarraiaConfigDir();
    // config.yml wins over config.toml in the Rust loader, but both are backed
    // up: an install can carry a stale .toml that becomes live if the .yml is
    // removed, and restoring only one of the pair loses that state.
    const manifest = {
      agentDefinitionId: this.definition.id,
      items: [
        {
          sourcePath: path.join(configDir, 'config.yml'),
          relativePath: 'config.yml',
          description: 'GarraIA core configuration (YAML, takes precedence)',
          required: false,
        },
        {
          sourcePath: path.join(configDir, 'config.toml'),
          relativePath: 'config.toml',
          description: 'GarraIA core configuration (TOML, legacy)',
          required: false,
        },
        {
          sourcePath: path.join(configDir, 'mcp.json'),
          relativePath: 'mcp.json',
          description: 'GarraIA MCP server registrations',
          required: false,
        },
        {
          sourcePath: path.join(configDir, 'channels'),
          relativePath: 'channels',
          description: 'GarraIA channel connector configurations',
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
    // The official installer downloads the prebuilt `garraia-<os>-<arch>`
    // release asset and verifies its `.sha256` sibling. `cargo install` was
    // wrong twice over: `--path .` builds whatever happens to be in the CWD,
    // and the crate is not published to crates.io.
    options?.onProgress?.('Downloading the GarraIA installer...', 20);
    await executeSafeCommand({
      command: 'sh',
      args: ['-c', 'curl -fsSL https://garraia.org/install.sh | sh -s -- --skip-setup --skip-start'],
      timeoutMs: 600000,
    });
    this.binaryPathCache = null;
    options?.onProgress?.('GarraIA installed successfully', 100);
  }

  public async upgrade(options?: UpgradeOptions): Promise<void> {
    if (options?.dryRun) {
      options?.onProgress?.('Dry run: garra update --yes', 100);
      return;
    }
    const binPath = await this.findBinary();
    if (!binPath) {
      // Nothing installed yet — upgrading is just installing.
      await this.install({ onProgress: options?.onProgress });
      return;
    }
    // `garra update` resolves the release asset by exact name, verifies the
    // SHA-256 sibling and swaps the binary atomically with a `.old` rollback.
    options?.onProgress?.('Upgrading GarraIA via `garra update`...', 50);
    await executeSafeCommand({
      command: binPath,
      args: ['update', '--yes'],
      timeoutMs: 600000,
    });
    this.binaryPathCache = null;
    options?.onProgress?.('GarraIA upgrade completed', 100);
  }

  public async rollback(backup: BackupResult): Promise<void> {
    const configDir = await resolveGarraiaConfigDir();
    for (const file of backup.backedUpFiles) {
      const src = path.join(backup.backupPath, file);
      const dest = path.join(configDir, file);
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
      const mock = `[GarraIA Response] Processed prompt: ${promptText.slice(0, 100)}`;
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
      throw new Error('GarraIA binary (garra/garraia) not found');
    }

    const promptText = context.promptTree.finalRawPrompt;
    let fullStdout = '';
    let fullStderr = '';

    // Programmatic CLI invocation using `ask --json` reading from stdin (robust & safe)
    const output = await executeSafeCommand(
      {
        command: binPath,
        args: ['ask', '--json'],
        stdin: promptText,
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
      throw new Error(`GarraIA process failed with exit code ${output.exitCode}: ${stderrClean || stdoutClean || 'Process failed'}`);
    }

    let parsedContent = '';
    try {
      const jsonRes = JSON.parse(stdoutClean);
      // garra.ask.v1 envelope: { answer: "...", response: "...", content: "...", text: "...", reply: "..." }
      parsedContent = jsonRes.answer || jsonRes.response || jsonRes.content || jsonRes.text || jsonRes.reply || (typeof jsonRes === 'string' ? jsonRes : '');
    } catch {
      parsedContent = stdoutClean;
    }

    if (!parsedContent && !stdoutClean) {
      if (stderrClean) {
        throw new Error(`GarraIA returned empty response (diagnostics: ${stderrClean})`);
      }
      throw new Error('EMPTY_AGENT_RESPONSE: GarraIA produced no output.');
    }

    const finalContent = parsedContent || stdoutClean;
    const estTokens = Math.ceil((promptText.length + finalContent.length) / 4);

    return {
      content: finalContent,
      rawStdout: stdoutClean,
      rawStderr: stderrClean,
      exitCode: output.exitCode,
      transport: 'cli-json',
      tokensUsed: {
        input: { source: 'estimated', value: Math.ceil(promptText.length / 4) },
        output: { source: 'estimated', value: Math.ceil(finalContent.length / 4) },
        total: { source: 'estimated', value: estTokens },
      },
      costUSD: { source: 'estimated', value: (estTokens / 1000) * 0.002 },
    };
  }
}

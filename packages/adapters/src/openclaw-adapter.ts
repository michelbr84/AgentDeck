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
import { OWNERSHIP_KEY as OWNERSHIP_MARKER_KEY } from '@agentdeck/adapter-sdk';
import { openclawModelRef, providerEnvVar } from './llm-shared.js';
import { fetchLatestNpmVersion } from './agent-paths.js';

/**
 * The package `install()` and `upgrade()` pull from. Its `latest` dist-tag is
 * exactly what `npm install -g openclaw@latest` would put on disk, which makes
 * the registry — not a GitHub tag — the honest answer to "is there an upgrade".
 */
const OPENCLAW_NPM_PACKAGE = 'openclaw';

export class OpenClawAdapter implements AgentAdapter, LlmConfigurable {
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
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      return {
        latestVersion: '2026.7.1-2',
        releaseNotes: 'OpenClaw Multi-Channel Release',
      };
    }
    // `null` means "could not determine", never a remembered constant: the
    // manager treats it as unknown (short retry TTL, never "outdated").
    const latestVersion = await fetchLatestNpmVersion(OPENCLAW_NPM_PACKAGE);
    if (!latestVersion) {
      return {
        latestVersion: null,
        releaseNotes: 'Could not reach the npm registry; latest version unknown.',
      };
    }
    return {
      latestVersion,
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


  // ==========================================
  // LlmConfigurable
  // ==========================================

  public readonly llmConfig: LlmConfigCapabilities = {
    // OpenClaw has a real fallback list under agents.defaults.model.
    backupStrategy: 'native',
    supportsBackup: true,
    // The key goes into the config's own `env` block rather than being inlined
    // into a model definition, which keeps it in exactly one place per file.
    keyDelivery: 'env-in-config',
    configFiles: [path.join(os.homedir(), '.openclaw', 'openclaw.json')],
  };

  private get configPath(): string {
    return path.join(os.homedir(), '.openclaw', 'openclaw.json');
  }

  /** The leaves this adapter owns. Everything else in the file is the user's. */
  private managedKeys(routing: LlmRouting): { key: string; value: string; secret?: boolean }[] {
    const keys: { key: string; value: string; secret?: boolean }[] = [
      { key: 'agents.defaults.model.primary', value: openclawModelRef(routing.primary) },
    ];
    if (routing.backup) {
      keys.push({
        key: 'agents.defaults.model.fallback',
        value: openclawModelRef(routing.backup),
      });
    }
    const envVar = providerEnvVar(routing.primary.providerId);
    if (envVar && routing.primary.credentialRef) {
      keys.push({ key: `env.${envVar}`, value: '', secret: true });
    }
    return keys;
  }

  public async readLlmConfig(): Promise<LlmConfigReadResult> {
    const warnings: string[] = [];
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

    const parseRef = (raw: unknown): ProviderBinding | null => {
      if (typeof raw !== 'string' || !raw.includes('/')) return null;
      const idx = raw.indexOf('/');
      const providerId = raw.slice(0, idx);
      const model = raw.slice(idx + 1);
      if (!model) return null;
      return { providerId: providerId as ProviderBinding['providerId'], model };
    };

    const marker = readOwnershipMarker(config);
    return {
      primary: parseRef(getPath(config, 'agents.defaults.model.primary')),
      backup: parseRef(getPath(config, 'agents.defaults.model.fallback')),
      managedByAgentDeck: marker !== null,
      routingHash: marker?.routingHash ?? null,
      drift: [],
      warnings,
    };
  }

  public async applyLlmConfig(
    routing: LlmRouting,
    opts: ApplyLlmConfigOptions
  ): Promise<ApplyLlmConfigResult> {
    const warnings: string[] = [];
    const file = this.configPath;
    const config = await readJsonConfig(file);
    const marker = readOwnershipMarker(config);
    const desired = this.managedKeys(routing);

    // Nothing to do when the same routing is already ours and untouched.
    const drift = detectDrift(
      config,
      marker,
      desired.filter((d) => !d.secret).map(({ key, value }) => ({ key, value }))
    );
    if (marker?.routingHash === routingHash(routing) && drift.length === 0) {
      return {
        changed: false,
        alreadyCurrent: true,
        diff: [],
        filesWritten: [],
        backup: null,
        warnings,
      };
    }
    if (drift.length > 0 && !opts.force) {
      throw new Error(
        `${file} has hand-edited keys AgentDeck manages (${drift.join(', ')}). ` +
          'Re-run with --force to overwrite them.'
      );
    }

    // Resolve the credential only now, immediately before it is needed.
    let secret: string | null = null;
    const envVar = providerEnvVar(routing.primary.providerId);
    if (envVar && routing.primary.credentialRef) {
      secret = await opts.resolveSecret(routing.primary.credentialRef);
      if (!secret) {
        warnings.push(`No stored credential for ${routing.primary.providerId}; left ${envVar} alone.`);
      }
    }

    const diff: ConfigDiffEntry[] = diffKeys(file, config, desired);

    if (opts.dryRun) {
      return { changed: diff.length > 0, alreadyCurrent: false, diff, filesWritten: [], backup: null, warnings };
    }

    if (secret) await assertPrivateBeforeSecret(file);

    opts.onProgress?.('Writing OpenClaw model routing');
    setPath(config, 'agents.defaults.model.primary', openclawModelRef(routing.primary));
    if (routing.backup) {
      setPath(config, 'agents.defaults.model.fallback', openclawModelRef(routing.backup));
    }
    // Register both models so the allowlist recognises them by full ref.
    //
    // Assigned directly rather than through setPath: model ids contain dots
    // (`glm-5.3-flash`, `qwen3.5:2b`) and setPath treats a dot as a nesting
    // separator, which turned `models["openrouter/z-ai/glm-5.3-flash"]` into
    // `models["openrouter/z-ai/glm-5"]["3-flash"]`.
    if (typeof config['models'] !== 'object' || config['models'] === null || Array.isArray(config['models'])) {
      config['models'] = {};
    }
    const modelsMap = config['models'] as Record<string, unknown>;
    modelsMap[openclawModelRef(routing.primary)] = modelsMap[openclawModelRef(routing.primary)] ?? {};
    if (routing.backup) {
      const backupRef = openclawModelRef(routing.backup);
      modelsMap[backupRef] = modelsMap[backupRef] ?? {};
    }
    if (secret && envVar) setPath(config, `env.${envVar}`, secret);

    config[OWNERSHIP_MARKER_KEY] = buildOwnershipMarker(
      routing,
      desired.map((d) => d.key),
      AGENTDECK_VERSION,
      new Date().toISOString()
    );

    await writeJsonConfigAtomic(file, config);

    // Never trust a blind shell-out: confirm the value actually landed.
    const verify = await readJsonConfig(file);
    if (getPath(verify, 'agents.defaults.model.primary') !== openclawModelRef(routing.primary)) {
      throw new Error(`OpenClaw config write did not take effect in ${file}`);
    }

    return { changed: true, alreadyCurrent: false, diff, filesWritten: [file], backup: null, warnings };
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

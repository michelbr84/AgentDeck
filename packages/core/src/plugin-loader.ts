import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { AgentAdapter, ExecutionContext, ExecutionResult } from '@agentdeck/adapter-sdk';
import { AgentCapabilities, AgentDefinition, HealthReport, HealthCheckLevel } from '@agentdeck/protocol';
import { executeSafeCommand } from '@agentdeck/adapter-sdk';
import { compareSemver } from '@agentdeck/adapters';
import { AGENTDECK_VERSION } from '@agentdeck/shared';

export const SimplePluginManifestSchema = z.object({
  apiVersion: z.literal('agentdeck.io/v1alpha1'),
  kind: z.literal('AgentPlugin'),
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().default('1.0.0'),
  description: z.string().default(''),
  category: z.string().default('coding'),
  detect: z.object({
    which: z.string(),
    standardPaths: z.array(z.string()).default([]),
  }),
  versionCheck: z.object({
    command: z.string(),
    args: z.array(z.string()).default(['--version']),
    regex: z.string().default('([0-9]+\\.[0-9]+\\.[0-9]+)'),
  }),
  install: z.object({
    ubuntu: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
  }).optional(),
  upgrade: z.object({
    command: z.string(),
    args: z.array(z.string()).default(['upgrade']),
  }).optional(),
  execution: z
    .object({
      command: z
        .string()
        .refine((c) => !/[;&|`$><\n\r]/.test(c), 'execution.command must not contain shell metacharacters'),
      args: z.array(z.string()).default(['--prompt', '{{prompt}}']),
    })
    .refine((e) => e.args.filter((a) => a === '{{prompt}}').length === 1, {
      message: "execution.args must contain the '{{prompt}}' placeholder exactly once, as its own argument",
    }),
  capabilities: z.record(z.boolean()).default({}),
});

export type SimplePluginManifest = z.infer<typeof SimplePluginManifestSchema>;

export class DeclarativePluginAdapter implements AgentAdapter {
  public readonly definition: AgentDefinition;
  public readonly manifest: SimplePluginManifest;

  constructor(manifest: SimplePluginManifest) {
    this.manifest = manifest;
    this.definition = {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description || `${manifest.name} plugin adapter`,
      version: manifest.version,
      capabilities: {
        install: !!manifest.install,
        upgrade: !!manifest.upgrade,
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
        nativeIdentity: false,
        tools: false,
        mcp: false,
        workspaceIsolation: false,
        nativeMemory: false,
        skills: false,
        channels: false,
        ...manifest.capabilities,
      },
      rollbackCapabilities: {
        config: true,
        binary: false,
      },
      supportedPlatforms: ['linux', 'darwin', 'win32'],
      supportedArchitectures: ['x64', 'arm64'],
    };
  }

  public get capabilities(): AgentCapabilities {
    return this.definition.capabilities;
  }

  public get rollbackCapabilities() {
    return this.definition.rollbackCapabilities;
  }

  public async detect() {
    try {
      const res = await executeSafeCommand({ command: 'which', args: [this.manifest.detect.which] });
      const bin = res.stdout.trim();
      if (!bin) {
        return {
          installed: false,
          binaryPath: null,
          version: null,
          state: {
            availability: 'available' as const,
            installation: 'not_installed' as const,
            configuration: 'unconfigured' as const,
            authentication: 'unknown' as const,
            health: 'unknown' as const,
            version: 'unknown' as const,
            runtime: 'stopped' as const,
          },
        };
      }

      let version: string | null = null;
      try {
        const vRes = await executeSafeCommand({
          command: this.manifest.versionCheck.command || bin,
          args: this.manifest.versionCheck.args,
        });
        const match = vRes.stdout.match(new RegExp(this.manifest.versionCheck.regex));
        if (match && match[1]) version = match[1];
      } catch {
        // ignore
      }

      return {
        installed: true,
        binaryPath: bin,
        version,
        state: {
          availability: 'available' as const,
          installation: 'installed' as const,
          configuration: 'configured' as const,
          authentication: 'unknown' as const,
          health: 'healthy' as const,
          version: 'current' as const,
          runtime: 'stopped' as const,
        },
      };
    } catch {
      return {
        installed: false,
        binaryPath: null,
        version: null,
        state: {
          availability: 'available' as const,
          installation: 'not_installed' as const,
          configuration: 'unconfigured' as const,
          authentication: 'unknown' as const,
          health: 'unknown' as const,
          version: 'unknown' as const,
          runtime: 'stopped' as const,
        },
      };
    }
  }

  public async getLatestVersion() {
    return {
      latestVersion: this.manifest.version,
    };
  }

  public async checkHealth(level: HealthCheckLevel): Promise<HealthReport> {
    const det = await this.detect();
    return {
      agentDefinitionId: this.definition.id,
      checkedAt: new Date().toISOString(),
      level,
      overallStatus: det.installed ? 'healthy' : 'unhealthy',
      diagnostics: [
        {
          name: 'binary_check',
          status: det.installed ? 'pass' : 'fail',
          message: det.installed ? `Found at ${det.binaryPath}` : `Executable ${this.manifest.detect.which} not found`,
        },
      ],
    };
  }

  public async backupConfig(backupDir: string) {
    await fs.mkdir(backupDir, { recursive: true });
    return {
      backupPath: backupDir,
      manifest: { agentDefinitionId: this.definition.id, items: [] },
      backedUpFiles: [],
      skippedFiles: [],
      timestamp: new Date().toISOString(),
    };
  }

  public async install() {
    if (this.manifest.install?.command) {
      await executeSafeCommand({
        command: this.manifest.install.command,
        args: this.manifest.install.args || [],
      });
    }
  }

  public async upgrade() {
    if (this.manifest.upgrade?.command) {
      await executeSafeCommand({
        command: this.manifest.upgrade.command,
        args: this.manifest.upgrade.args || [],
      });
    }
  }

  public async rollback() {}

  public async execute(context: ExecutionContext): Promise<ExecutionResult> {
    if (process.env.AGENTDECK_MOCK_EXECUTION === 'true' || process.env.NODE_ENV === 'test') {
      const promptText = context.promptTree.finalRawPrompt;
      const mock = `[${this.manifest.name} Plugin] Processed prompt: ${promptText.slice(0, 80)}`;
      context.onChunk?.(mock);
      return {
        content: mock,
        rawStdout: mock,
        rawStderr: '',
        exitCode: 0,
        transport: 'mock',
        tokensUsed: {
          input: { source: 'estimated' as const, value: Math.ceil(promptText.length / 4) },
          output: { source: 'estimated' as const, value: Math.ceil(mock.length / 4) },
          total: { source: 'estimated' as const, value: Math.ceil((promptText.length + mock.length) / 4) },
        },
        costUSD: { source: 'estimated' as const, value: 0.001 },
      };
    }

    const promptText = context.promptTree.finalRawPrompt;
    const det = await this.detect();
    if (!det.installed || !det.binaryPath) {
      throw new Error(`${this.manifest.name} binary not found. Install it or deactivate this instance.`);
    }

    // The prompt travels as opaque user content, exactly like the built-in
    // adapters — rendering it into a plain string arg made every multi-line
    // prompt fail isSafeCliArgument's newline check.
    const renderedArgs = this.manifest.execution.args.map((a: string) =>
      a === '{{prompt}}' ? ({ value: promptText, type: 'opaque-user-content' as const }) : a
    );

    let fullStdout = '';
    let fullStderr = '';
    const out = await executeSafeCommand(
      {
        command: this.manifest.execution.command || det.binaryPath,
        args: renderedArgs,
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

    const content = (out.stdout || fullStdout).trim() || (out.stderr || fullStderr).trim();
    return {
      content,
      tokensUsed: {
        input: { source: 'estimated' as const, value: Math.ceil(promptText.length / 4) },
        output: { source: 'estimated' as const, value: Math.ceil(content.length / 4) },
        total: { source: 'estimated' as const, value: Math.ceil((promptText.length + content.length) / 4) },
      },
      costUSD: { source: 'estimated' as const, value: 0.001 },
    };
  }
}

/**
 * Tier-2 programmatic plugins: a manifest pointing at a prebuilt ESM entry
 * module whose default (or named) `createAdapter(sdk)` factory returns an
 * AgentAdapter. The SDK surface is INJECTED as an argument — plugins living
 * in ~/.agentdeck/plugins cannot resolve @agentdeck/* packages under the
 * standalone install layout, so importing the SDK from the plugin is a trap
 * the factory contract sidesteps entirely.
 */
export const ProgrammaticPluginManifestSchema = z.object({
  apiVersion: z.literal('agentdeck.io/v1alpha1'),
  kind: z.literal('AgentPluginModule'),
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().default('1.0.0'),
  description: z.string().default(''),
  /** Path of the prebuilt ESM entry, relative to the plugin directory. */
  entry: z.string().min(1),
  engines: z
    .object({
      /** Minimum AgentDeck version the plugin needs (plain semver). */
      agentdeck: z.string().optional(),
    })
    .optional(),
});
export type ProgrammaticPluginManifest = z.infer<typeof ProgrammaticPluginManifestSchema>;

/** The capability surface handed to a Tier-2 plugin factory. */
export interface PluginSdk {
  agentdeckVersion: string;
  executeSafeCommand: typeof executeSafeCommand;
}

export type AnyPluginManifest =
  | { kind: 'AgentPlugin'; manifest: SimplePluginManifest }
  | { kind: 'AgentPluginModule'; manifest: ProgrammaticPluginManifest };

const MANIFEST_FILENAMES = ['manifest.json', 'manifest.yaml', 'manifest.yml'];

/**
 * Reads and validates a plugin directory's manifest (JSON or YAML).
 * Throws with a readable message when nothing valid is found.
 */
export async function readPluginManifest(pluginDir: string): Promise<AnyPluginManifest> {
  let lastError: Error | null = null;
  for (const filename of MANIFEST_FILENAMES) {
    const manifestPath = path.join(pluginDir, filename);
    let raw: string;
    try {
      raw = await fs.readFile(manifestPath, 'utf8');
    } catch {
      continue;
    }
    try {
      const data = filename.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw);
      const kind = (data as { kind?: string } | null)?.kind;
      if (kind === 'AgentPluginModule') {
        return { kind: 'AgentPluginModule', manifest: ProgrammaticPluginManifestSchema.parse(data) };
      }
      return { kind: 'AgentPlugin', manifest: SimplePluginManifestSchema.parse(data) };
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw new Error(
    `No valid plugin manifest (manifest.json|yaml|yml) in ${pluginDir}${lastError ? `: ${lastError.message}` : ''}`
  );
}

function assertEngineCompatible(manifest: ProgrammaticPluginManifest): void {
  const required = manifest.engines?.agentdeck;
  if (!required) return;
  if (compareSemver(AGENTDECK_VERSION, required) < 0) {
    throw new Error(
      `Plugin "${manifest.id}" requires AgentDeck >= ${required} (running ${AGENTDECK_VERSION})`
    );
  }
}

/** Duck-type check of the factory's product against the AgentAdapter contract. */
function isAdapterShaped(value: unknown): value is AgentAdapter {
  const candidate = value as Partial<AgentAdapter> | null;
  return Boolean(
    candidate &&
      typeof candidate === 'object' &&
      candidate.definition &&
      typeof candidate.definition.id === 'string' &&
      typeof candidate.execute === 'function' &&
      typeof candidate.detect === 'function'
  );
}

export async function loadProgrammaticPlugin(
  pluginDir: string,
  manifest: ProgrammaticPluginManifest
): Promise<AgentAdapter> {
  assertEngineCompatible(manifest);

  const entryPath = path.resolve(pluginDir, manifest.entry);
  // The entry must stay inside the plugin directory — a manifest pointing at
  // ../../ elsewhere on disk is malformed at best.
  if (!entryPath.startsWith(path.resolve(pluginDir) + path.sep)) {
    throw new Error(`Plugin "${manifest.id}" entry escapes its directory: ${manifest.entry}`);
  }
  await fs.access(entryPath);

  const mod = (await import(pathToFileURL(entryPath).href)) as Record<string, unknown>;
  const factory = (mod['createAdapter'] ?? mod['default']) as
    | ((sdk: PluginSdk) => AgentAdapter | Promise<AgentAdapter>)
    | undefined;
  if (typeof factory !== 'function') {
    throw new Error(
      `Plugin "${manifest.id}" entry must export a createAdapter(sdk) factory (named or default)`
    );
  }

  const sdk: PluginSdk = {
    agentdeckVersion: AGENTDECK_VERSION,
    executeSafeCommand,
  };
  const adapter = await factory(sdk);
  if (!isAdapterShaped(adapter)) {
    throw new Error(
      `Plugin "${manifest.id}" factory did not return an AgentAdapter (definition.id, detect() and execute() are required)`
    );
  }
  return adapter;
}

export class PluginLoader {
  private pluginsDir: string;

  constructor(pluginsDir?: string) {
    this.pluginsDir = pluginsDir || path.join(os.homedir(), '.agentdeck', 'plugins');
  }

  public get directory(): string {
    return this.pluginsDir;
  }

  public async loadAllPlugins(): Promise<AgentAdapter[]> {
    const adapters: AgentAdapter[] = [];
    try {
      await fs.mkdir(this.pluginsDir, { recursive: true });
      const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pluginDir = path.join(this.pluginsDir, entry.name);
        // Per-plugin try/catch: one broken plugin must never break
        // AgentDeckManager.create().
        try {
          const found = await readPluginManifest(pluginDir);
          if (found.kind === 'AgentPluginModule') {
            adapters.push(await loadProgrammaticPlugin(pluginDir, found.manifest));
          } else {
            adapters.push(new DeclarativePluginAdapter(found.manifest));
          }
        } catch {
          // invalid or missing manifest / broken entry module — skip
        }
      }
    } catch {
      // directory read failure
    }
    return adapters;
  }
}

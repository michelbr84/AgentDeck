import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { AgentAdapter, ExecutionContext, ExecutionResult } from '@agentdeck/adapter-sdk';
import { AgentCapabilities, AgentDefinition, HealthReport, HealthCheckLevel } from '@agentdeck/protocol';
import { executeSafeCommand } from '@agentdeck/adapter-sdk';

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
  execution: z.object({
    command: z.string(),
    args: z.array(z.string()).default(['--prompt', '{{prompt}}']),
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

    const renderedArgs = this.manifest.execution.args.map((a: string) =>
      a.replace('{{prompt}}', promptText)
    );

    const out = await executeSafeCommand({
      command: this.manifest.execution.command || det.binaryPath,
      args: renderedArgs,
      cwd: context.workspaceDir || process.cwd(),
      abortSignal: context.abortSignal,
    });

    const content = out.stdout.trim() || out.stderr.trim();
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

export class PluginLoader {
  private pluginsDir: string;

  constructor(pluginsDir?: string) {
    this.pluginsDir = pluginsDir || path.join(os.homedir(), '.agentdeck', 'plugins');
  }

  public async loadAllPlugins(): Promise<AgentAdapter[]> {
    const adapters: AgentAdapter[] = [];
    try {
      await fs.mkdir(this.pluginsDir, { recursive: true });
      const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const manifestPath = path.join(this.pluginsDir, entry.name, 'manifest.json');
          try {
            const raw = await fs.readFile(manifestPath, 'utf8');
            const json = JSON.parse(raw);
            const parsed = SimplePluginManifestSchema.parse(json);
            adapters.push(new DeclarativePluginAdapter(parsed));
          } catch {
            // not a declarative JSON manifest or invalid
          }
        }
      }
    } catch {
      // directory read failure
    }
    return adapters;
  }
}

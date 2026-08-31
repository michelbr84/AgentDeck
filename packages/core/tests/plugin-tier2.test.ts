import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  PluginLoader,
  readPluginManifest,
  SimplePluginManifestSchema,
  parsePluginSource,
  installPlugin,
  removePlugin,
  INSTALL_RECEIPT_FILENAME,
  DeclarativePluginAdapter,
} from '../src/index.js';
import type { ExecutionContext } from '@agentdeck/adapter-sdk';

async function tmpdir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-plugins-'));
}

const TIER2_ENTRY = `
export function createAdapter(sdk) {
  return {
    definition: {
      id: 'tier2-demo',
      name: 'Tier2 Demo',
      description: 'built against agentdeck ' + sdk.agentdeckVersion,
      version: '1.0.0',
      capabilities: {},
      rollbackCapabilities: { config: false, binary: false },
      supportedPlatforms: ['linux'],
      supportedArchitectures: ['x64'],
    },
    capabilities: {},
    rollbackCapabilities: { config: false, binary: false },
    detect: async () => ({
      installed: true,
      binaryPath: null,
      version: '1.0.0',
      state: {
        availability: 'available', installation: 'installed', configuration: 'configured',
        authentication: 'unknown', health: 'healthy', version: 'current', runtime: 'stopped',
      },
    }),
    getLatestVersion: async () => ({ latestVersion: '1.0.0' }),
    execute: async (ctx) => ({
      content: 'tier2 says: ' + ctx.promptTree.finalRawPrompt.slice(0, 20),
      tokensUsed: {
        input: { source: 'estimated', value: 1 },
        output: { source: 'estimated', value: 1 },
        total: { source: 'estimated', value: 2 },
      },
      costUSD: { source: 'estimated', value: 0 },
    }),
  };
}
`;

const TIER2_MANIFEST_YAML = `
apiVersion: agentdeck.io/v1alpha1
kind: AgentPluginModule
id: tier2-demo
name: Tier2 Demo
version: 1.0.0
description: demo programmatic plugin
entry: index.mjs
engines:
  agentdeck: 1.0.0
`;

describe('plugin Tier-2 loader + YAML manifests', () => {
  it('loads a programmatic plugin via createAdapter(sdk) factory injection', async () => {
    const dir = await tmpdir();
    const pluginDir = path.join(dir, 'tier2-demo');
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(path.join(pluginDir, 'manifest.yaml'), TIER2_MANIFEST_YAML, 'utf8');
    await fs.writeFile(path.join(pluginDir, 'index.mjs'), TIER2_ENTRY, 'utf8');

    const loader = new PluginLoader(dir);
    const adapters = await loader.loadAllPlugins();
    expect(adapters).toHaveLength(1);
    expect(adapters[0]!.definition.id).toBe('tier2-demo');
    // The SDK surface reached the factory as an argument (no @agentdeck imports).
    expect(adapters[0]!.definition.description).toContain('built against agentdeck 1.');
  });

  it('reads Tier-1 manifests from YAML as well as JSON', async () => {
    const dir = await tmpdir();
    const pluginDir = path.join(dir, 'yaml-t1');
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginDir, 'manifest.yml'),
      [
        'apiVersion: agentdeck.io/v1alpha1',
        'kind: AgentPlugin',
        'id: yaml-t1',
        'name: Yaml Tier1',
        'detect: { which: echo }',
        'versionCheck: { command: echo }',
        'execution: { command: echo }',
      ].join('\n'),
      'utf8'
    );

    const found = await readPluginManifest(pluginDir);
    expect(found.kind).toBe('AgentPlugin');
    expect(found.manifest.id).toBe('yaml-t1');
  });

  it('a broken plugin never breaks its neighbors', async () => {
    const dir = await tmpdir();
    const broken = path.join(dir, 'broken');
    await fs.mkdir(broken, { recursive: true });
    await fs.writeFile(
      path.join(broken, 'manifest.yaml'),
      'apiVersion: agentdeck.io/v1alpha1\nkind: AgentPluginModule\nid: broken\nname: Broken\nentry: missing.mjs\n',
      'utf8'
    );
    const healthy = path.join(dir, 'tier2-demo');
    await fs.mkdir(healthy, { recursive: true });
    await fs.writeFile(path.join(healthy, 'manifest.yaml'), TIER2_MANIFEST_YAML, 'utf8');
    await fs.writeFile(path.join(healthy, 'index.mjs'), TIER2_ENTRY, 'utf8');

    const adapters = await new PluginLoader(dir).loadAllPlugins();
    expect(adapters.map((a) => a.definition.id)).toEqual(['tier2-demo']);
  });

  it('rejects declarative manifests with unsafe or ambiguous prompt templates', () => {
    const base = {
      apiVersion: 'agentdeck.io/v1alpha1',
      kind: 'AgentPlugin',
      id: 'x',
      name: 'X',
      detect: { which: 'x' },
      versionCheck: { command: 'x' },
    };
    expect(() =>
      SimplePluginManifestSchema.parse({ ...base, execution: { command: 'x', args: ['{{prompt}}', '{{prompt}}'] } })
    ).toThrow(/exactly once/);
    expect(() =>
      SimplePluginManifestSchema.parse({ ...base, execution: { command: 'x; rm -rf /', args: ['{{prompt}}'] } })
    ).toThrow(/shell metacharacters/);
    expect(() =>
      SimplePluginManifestSchema.parse({ ...base, execution: { command: 'x', args: ['--prompt', '{{prompt}}'] } })
    ).not.toThrow();
  });

  it('passes multi-line prompts to declarative plugins as opaque content', async () => {
    const manifest = SimplePluginManifestSchema.parse({
      apiVersion: 'agentdeck.io/v1alpha1',
      kind: 'AgentPlugin',
      id: 'echoer',
      name: 'Echoer',
      detect: { which: 'echo' },
      versionCheck: { command: 'echo' },
      execution: { command: 'echo', args: ['{{prompt}}'] },
    });
    const adapter = new DeclarativePluginAdapter(manifest);
    const multiline = 'first line\nsecond line with "quotes" and $vars';
    const ctx = {
      runId: 'r',
      sessionId: 's',
      promptTree: { finalRawPrompt: multiline, layers: [] },
      abortSignal: new AbortController().signal,
    } as unknown as ExecutionContext;

    const result = await adapter.execute(ctx);
    // Before the opaque-content fix this threw on the embedded newline.
    expect(result.content).toContain('first line');
    expect(result.content).toContain('second line');
  });
});

describe('plugin installer', () => {
  it('parses sources and refuses unpinned github refs', () => {
    expect(parsePluginSource('github:acme/tool#v1.2.3')).toEqual({
      type: 'github',
      owner: 'acme',
      repo: 'tool',
      ref: 'v1.2.3',
    });
    expect(() => parsePluginSource('github:acme/tool')).toThrow(/pinned ref/);
    expect(parsePluginSource('file:/tmp/somewhere').type).toBe('local');
    expect(parsePluginSource('./relative').type).toBe('local');
  });

  it('installs from a local directory with a receipt, and refuses duplicates', async () => {
    const sourceDir = await tmpdir();
    await fs.writeFile(path.join(sourceDir, 'manifest.yaml'), TIER2_MANIFEST_YAML, 'utf8');
    await fs.writeFile(path.join(sourceDir, 'index.mjs'), TIER2_ENTRY, 'utf8');
    const pluginsDir = await tmpdir();

    await expect(installPlugin(sourceDir, { pluginsDir, confirmed: false })).rejects.toThrow(/not confirmed/i);

    const result = await installPlugin(sourceDir, { pluginsDir, confirmed: true });
    expect(result.pluginId).toBe('tier2-demo');
    expect(result.kind).toBe('AgentPluginModule');

    const receiptRaw = await fs.readFile(path.join(result.pluginDir, INSTALL_RECEIPT_FILENAME), 'utf8');
    const receipt = JSON.parse(receiptRaw);
    expect(receipt.pluginId).toBe('tier2-demo');
    expect(receipt.resolved.type).toBe('local');

    // The installed plugin actually loads.
    const adapters = await new PluginLoader(pluginsDir).loadAllPlugins();
    expect(adapters.map((a) => a.definition.id)).toEqual(['tier2-demo']);

    await expect(installPlugin(sourceDir, { pluginsDir, confirmed: true })).rejects.toThrow(/already installed/);

    await removePlugin('tier2-demo', pluginsDir);
    expect(await new PluginLoader(pluginsDir).loadAllPlugins()).toHaveLength(0);
    await expect(removePlugin('tier2-demo', pluginsDir)).rejects.toThrow(/not installed/);
  });

  it('rejects entries that escape the plugin directory', async () => {
    const dir = await tmpdir();
    const pluginDir = path.join(dir, 'escape');
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginDir, 'manifest.yaml'),
      'apiVersion: agentdeck.io/v1alpha1\nkind: AgentPluginModule\nid: escape\nname: Escape\nentry: ../../outside.mjs\n',
      'utf8'
    );
    const adapters = await new PluginLoader(dir).loadAllPlugins();
    expect(adapters).toHaveLength(0);
  });
});

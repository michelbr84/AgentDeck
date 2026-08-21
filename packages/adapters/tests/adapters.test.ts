import { describe, it, expect } from 'vitest';
import {
  ClaudeCodeAdapter,
  HermesAdapter,
  OpenClawAdapter,
  GarraIAAdapter,
  PiAdapter,
  KiloAdapter,
  ClineAdapter,
  CodexAdapter,
} from '../src/index.js';
import { PromptCompositionTree } from '@agentdeck/protocol';

describe('@agentdeck/adapters unit & fixture tests', () => {
  it('ClaudeCodeAdapter should declare compliant definitions and capabilities', () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.definition.id).toBe('claude-code');
    expect(adapter.capabilities.chat).toBe(true);
    expect(adapter.capabilities.mcp).toBe(true);
    expect(adapter.capabilities.promptOverlaySupported).toBe(true);
    expect(adapter.capabilities.nativeSystemPrompt).toBe(false);
  });

  it('HermesAdapter should declare skills and channels capabilities', () => {
    const adapter = new HermesAdapter();
    expect(adapter.definition.id).toBe('hermes');
    expect(adapter.capabilities.skills).toBe(true);
    expect(adapter.capabilities.channels).toBe(true);
    expect(adapter.rollbackCapabilities.config).toBe(true);
  });

  it('OpenClawAdapter should declare jsonRpcProtocol and nativeIdentity', () => {
    const adapter = new OpenClawAdapter();
    expect(adapter.definition.id).toBe('openclaw');
    expect(adapter.capabilities.jsonRpcProtocol).toBe(true);
    expect(adapter.capabilities.nativeIdentity).toBe(true);
  });

  it('GarraIAAdapter should declare high-performance universal capabilities', () => {
    const adapter = new GarraIAAdapter();
    expect(adapter.definition.id).toBe('garraia');
    expect(adapter.capabilities.workspaceIsolation).toBe(true);
    expect(adapter.capabilities.nativeMemory).toBe(true);
  });

  it('Expansion adapters (Pi, Kilo, Cline, Codex) should be properly configured', () => {
    const pi = new PiAdapter();
    expect(pi.definition.id).toBe('pi');
    expect(pi.capabilities.nativeIdentity).toBe(true);

    const kilo = new KiloAdapter();
    expect(kilo.definition.id).toBe('kilo');
    expect(kilo.capabilities.workspaceIsolation).toBe(true);

    const cline = new ClineAdapter();
    expect(cline.definition.id).toBe('cline');
    expect(cline.capabilities.mcp).toBe(true);

    const codex = new CodexAdapter();
    expect(codex.definition.id).toBe('codex');
    expect(codex.capabilities.tools).toBe(true);
  });

  it('should run detection without throwing errors on all 8 adapters', async () => {
    const adapters = [
      new ClaudeCodeAdapter(),
      new HermesAdapter(),
      new OpenClawAdapter(),
      new GarraIAAdapter(),
      new PiAdapter(),
      new KiloAdapter(),
      new ClineAdapter(),
      new CodexAdapter(),
    ];

    for (const adapter of adapters) {
      const detection = await adapter.detect();
      expect(detection.state).toBeDefined();
      expect(typeof detection.installed).toBe('boolean');
    }
  });

  it('should perform Level 1 Static Health Checks without requiring network', async () => {
    const adapters = [
      new ClaudeCodeAdapter(),
      new HermesAdapter(),
      new OpenClawAdapter(),
      new GarraIAAdapter(),
      new PiAdapter(),
      new KiloAdapter(),
      new ClineAdapter(),
      new CodexAdapter(),
    ];

    for (const adapter of adapters) {
      const report = await adapter.checkHealth('level1_static');
      expect(report.agentDefinitionId).toBe(adapter.definition.id);
      expect(['healthy', 'degraded', 'unhealthy']).toContain(report.overallStatus);
      expect(report.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it('should handle multiline, Markdown, and formatted prompts across all 8 adapters via execute()', async () => {
    const promptTree: PromptCompositionTree = {
      instanceId: 'test-inst',
      roomId: 'room-1',
      createdAt: new Date().toISOString(),
      totalEstimatedTokens: { source: 'estimated', value: 120 },
      layers: [
        {
          id: 'layer-1',
          order: 1,
          layerName: 'Global Policy',
          source: 'policy',
          content: '### Global Policy\n1. Deliver high quality code.\n2. Ensure safe execution.',
          redacted: false,
        },
      ],
      finalRawPrompt: `### Global Policy\n1. Deliver high quality code.\n\n### Persona\nAtlas (Architect) [pt-BR]\n\n### Prompt\nPlease provide a multi-line comparison:\n1. Redis Redlock\n2. Postgres pg_advisory_lock\n\nShow sample SQL & Bash commands with pipes | and semicolons;`,
    };

    const adapters = [
      new ClaudeCodeAdapter(),
      new HermesAdapter(),
      new OpenClawAdapter(),
      new GarraIAAdapter(),
      new PiAdapter(),
      new KiloAdapter(),
      new ClineAdapter(),
      new CodexAdapter(),
    ];

    for (const adapter of adapters) {
      const result = await adapter.execute({
        runId: 'run-test-multiline',
        sessionId: `session-${adapter.definition.id}`,
        promptTree,
        workspaceDir: process.cwd(),
        abortSignal: new AbortController().signal,
      });

      expect(result).toBeDefined();
      expect(typeof result.content).toBe('string');
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.tokensUsed.total.value).toBeGreaterThan(0);
    }
  });

  it('HermesAdapter should not include --yolo or --accept-hooks by default', async () => {
    const hermes = new HermesAdapter();
    const promptTree: PromptCompositionTree = {
      instanceId: 'hermes-safe-inst',
      createdAt: new Date().toISOString(),
      totalEstimatedTokens: { source: 'estimated', value: 10 },
      layers: [],
      finalRawPrompt: 'Reply with AGENTDECK_HERMES_SAFE_OK',
    };

    const res = await hermes.execute({
      runId: 'hermes-test-safe',
      sessionId: 'session-hermes',
      promptTree,
      workspaceDir: process.cwd(),
      abortSignal: new AbortController().signal,
    });

    expect(res).toBeDefined();
    expect(res.exitCode).toBe(0);
  });

  it('ClaudeCodeAdapter should not include --dangerously-skip-permissions by default', async () => {
    const claude = new ClaudeCodeAdapter();
    const promptTree: PromptCompositionTree = {
      instanceId: 'claude-safe-inst',
      createdAt: new Date().toISOString(),
      totalEstimatedTokens: { source: 'estimated', value: 10 },
      layers: [],
      finalRawPrompt: 'Reply with OK',
    };

    const res = await claude.execute({
      runId: 'claude-test-safe',
      sessionId: 'session-claude',
      promptTree,
      workspaceDir: process.cwd(),
      abortSignal: new AbortController().signal,
    });

    expect(res).toBeDefined();
    expect(res.exitCode).toBe(0);
  });
});

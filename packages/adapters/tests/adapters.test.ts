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
});

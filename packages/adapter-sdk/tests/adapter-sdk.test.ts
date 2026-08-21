import { describe, it, expect } from 'vitest';
import { AgentAdapter, ExecutionContext, ExecutionResult, DetectionResult, LatestVersionResult, BackupResult } from '../src/index.js';
import { AgentDefinition, HealthReport, HealthCheckLevel } from '@agentdeck/protocol';

class MockTestAdapter implements AgentAdapter {
  readonly definition: AgentDefinition = {
    id: 'mock-agent',
    name: 'Mock Agent',
    description: 'Test adapter for SDK validation',
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
      modelSelection: true,
      multipleInstances: true,
      nativeIdentity: false,
      tools: true,
      mcp: true,
      workspaceIsolation: true,
      nativeMemory: false,
      skills: false,
      channels: false,
    },
    rollbackCapabilities: {
      config: true,
      binary: false,
    },
    supportedPlatforms: ['linux'],
    supportedArchitectures: ['x64', 'arm64'],
  };

  get capabilities() {
    return this.definition.capabilities;
  }

  get rollbackCapabilities() {
    return this.definition.rollbackCapabilities;
  }

  async detect(): Promise<DetectionResult> {
    return {
      installed: true,
      binaryPath: '/usr/local/bin/mock-agent',
      version: '1.0.0',
      state: {
        availability: 'available',
        installation: 'installed',
        configuration: 'configured',
        authentication: 'authenticated',
        health: 'healthy',
        version: 'current',
        runtime: 'stopped',
      },
    };
  }

  async getLatestVersion(): Promise<LatestVersionResult> {
    return { latestVersion: '1.1.0', releaseNotes: 'Bug fixes' };
  }

  async checkHealth(level: HealthCheckLevel): Promise<HealthReport> {
    return {
      agentDefinitionId: this.definition.id,
      checkedAt: new Date().toISOString(),
      level,
      overallStatus: 'healthy',
      diagnostics: [{ name: 'Binary Check', status: 'pass', message: 'Binary operational' }],
    };
  }

  async backupConfig(backupDir: string): Promise<BackupResult> {
    return {
      backupPath: `${backupDir}/backup-1`,
      manifest: { agentDefinitionId: this.definition.id, items: [] },
      backedUpFiles: ['config.json'],
      skippedFiles: [],
      timestamp: new Date().toISOString(),
    };
  }

  async install(): Promise<void> {}
  async upgrade(): Promise<void> {}
  async rollback(): Promise<void> {}

  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    context.onChunk?.('Mock chunk');
    return {
      content: 'Mock response',
      tokensUsed: {
        input: { value: 10, source: 'reported' },
        output: { value: 20, source: 'reported' },
        total: { value: 30, source: 'reported' },
      },
      costUSD: { value: 0.001, source: 'estimated' },
    };
  }
}

describe('@agentdeck/adapter-sdk contract', () => {
  it('should allow mock adapters implementing the full lifecycle contract', async () => {
    const adapter = new MockTestAdapter();
    const detection = await adapter.detect();
    expect(detection.installed).toBe(true);
    expect(adapter.capabilities.mcp).toBe(true);
    expect(adapter.rollbackCapabilities.binary).toBe(false);

    const health = await adapter.checkHealth('level1_static');
    expect(health.overallStatus).toBe('healthy');
  });
});

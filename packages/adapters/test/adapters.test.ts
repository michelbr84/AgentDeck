import { describe, it, expect } from 'vitest';
import {
  ClaudeCodeAdapter,
  GarraIAAdapter,
  HermesAdapter,
  OpenClawAdapter,
} from '../src/index.js';

describe('Built-in Adapters & Normalized Return Shapes', () => {
  it('instantiates official adapters with proper capabilities', () => {
    const claude = new ClaudeCodeAdapter();
    const garra = new GarraIAAdapter();
    const hermes = new HermesAdapter();
    const openclaw = new OpenClawAdapter();

    expect(claude.definition.id).toBe('claude-code');
    expect(claude.capabilities.chat).toBe(true);

    expect(garra.definition.id).toBe('garraia');
    expect(garra.capabilities.channels).toBe(true);

    expect(hermes.definition.id).toBe('hermes');
    expect(hermes.capabilities.skills).toBe(true);

    expect(openclaw.definition.id).toBe('openclaw');
    expect(openclaw.capabilities.workspaceIsolation).toBe(true);
  });

  it('handles mock execution cleanly in test environment', async () => {
    const claude = new ClaudeCodeAdapter();
    const result = await claude.execute({
      runId: 'test-run',
      sessionId: 'test-session',
      promptTree: {
        instanceId: 'inst-test',
        createdAt: new Date().toISOString(),
        totalEstimatedTokens: { source: 'estimated', value: 10 },
        layers: [],
        finalRawPrompt: 'Write a unit test.',
      },
      abortSignal: new AbortController().signal,
    });

    expect(result.content).toBeDefined();
    expect(result.exitCode).toBe(0);
    expect(result.transport).toBe('mock');
    expect(result.tokensUsed.total.value).toBeGreaterThan(0);
  });

  it('HermesAdapter respects permissionPolicy settings', async () => {
    const hermes = new HermesAdapter();
    const promptTree = {
      instanceId: 'hermes-policy-inst',
      createdAt: new Date().toISOString(),
      totalEstimatedTokens: { source: 'estimated', value: 10 },
      layers: [],
      finalRawPrompt: 'Hello',
    };

    const resNormal = await hermes.execute({
      runId: 'test-run-normal',
      sessionId: 'test-session',
      promptTree,
      abortSignal: new AbortController().signal,
      permissionPolicy: 'normal',
    } as unknown as import('@agentdeck/adapter-sdk').ExecutionContext);
    expect(resNormal.exitCode).toBe(0);

    const resTrusted = await hermes.execute({
      runId: 'test-run-trusted',
      sessionId: 'test-session',
      promptTree,
      abortSignal: new AbortController().signal,
      permissionPolicy: 'trusted-hooks',
    } as unknown as import('@agentdeck/adapter-sdk').ExecutionContext);
    expect(resTrusted.exitCode).toBe(0);

    const resUnrestricted = await hermes.execute({
      runId: 'test-run-unrestricted',
      sessionId: 'test-session',
      promptTree,
      abortSignal: new AbortController().signal,
      permissionPolicy: 'unrestricted',
    } as unknown as import('@agentdeck/adapter-sdk').ExecutionContext);
    expect(resUnrestricted.exitCode).toBe(0);
  });
});

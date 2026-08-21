import { describe, it, expect, vi } from 'vitest';
import { HermesAdapter } from '../src/hermes-adapter.js';
import { ClaudeCodeAdapter } from '../src/claude-code-adapter.js';
import * as adapterSdk from '@agentdeck/adapter-sdk';

describe('Hermes & Claude Security and Permission Boundaries', () => {
  it('Hermes default command must NOT contain --yolo or --accept-hooks', async () => {
    const hermes = new HermesAdapter();
    vi.spyOn(hermes as unknown as { findBinary: () => Promise<string> }, 'findBinary').mockResolvedValue('/mock/bin/hermes');
    const executeSafeSpy = vi.spyOn(adapterSdk, 'executeSafeCommand').mockResolvedValue({
      stdout: 'AGENTDECK_HERMES_SAFE_OK',
      stderr: '',
      exitCode: 0,
    });

    const promptTree = {
      instanceId: 'inst-hermes-1',
      createdAt: new Date().toISOString(),
      totalEstimatedTokens: { source: 'estimated' as const, value: 10 },
      layers: [],
      finalRawPrompt: 'Reply with safe response',
    };

    // Default execution
    delete process.env.AGENTDECK_MOCK_EXECUTION;
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      await hermes.execute({
        runId: 'run-hermes-safe',
        sessionId: 'session-hermes',
        promptTree,
        workspaceDir: process.cwd(),
        abortSignal: new AbortController().signal,
      });

      expect(executeSafeSpy).toHaveBeenCalled();
      const lastCallArgs = executeSafeSpy.mock.calls[0]?.[0]?.args || [];
      const flatArgs = lastCallArgs.map((a: string | { value: string; type: string }) => (typeof a === 'string' ? a : a.value));

      expect(flatArgs).toContain('-z');
      expect(flatArgs).not.toContain('--yolo');
      expect(flatArgs).not.toContain('--accept-hooks');
    } finally {
      process.env.NODE_ENV = origEnv;
      executeSafeSpy.mockRestore();
    }
  });

  it('Hermes with trusted-hooks policy includes --accept-hooks only, not --yolo', async () => {
    const hermes = new HermesAdapter();
    vi.spyOn(hermes as unknown as { findBinary: () => Promise<string> }, 'findBinary').mockResolvedValue('/mock/bin/hermes');
    const executeSafeSpy = vi.spyOn(adapterSdk, 'executeSafeCommand').mockResolvedValue({
      stdout: 'OK',
      stderr: '',
      exitCode: 0,
    });

    const promptTree = {
      instanceId: 'inst-hermes-2',
      createdAt: new Date().toISOString(),
      totalEstimatedTokens: { source: 'estimated' as const, value: 10 },
      layers: [],
      finalRawPrompt: 'Run trusted hooks',
    };

    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      await hermes.execute({
        runId: 'run-hermes-trusted',
        sessionId: 'session-hermes',
        promptTree,
        workspaceDir: process.cwd(),
        abortSignal: new AbortController().signal,
        permissionPolicy: 'trusted-hooks',
      } as unknown as import('@agentdeck/adapter-sdk').ExecutionContext);

      const lastCallArgs = executeSafeSpy.mock.calls[0]?.[0]?.args || [];
      const flatArgs = lastCallArgs.map((a: string | { value: string; type: string }) => (typeof a === 'string' ? a : a.value));

      expect(flatArgs).toContain('-z');
      expect(flatArgs).toContain('--accept-hooks');
      expect(flatArgs).not.toContain('--yolo');
    } finally {
      process.env.NODE_ENV = origEnv;
      executeSafeSpy.mockRestore();
    }
  });

  it('Hermes with unrestricted policy includes --yolo only when explicitly enabled', async () => {
    const hermes = new HermesAdapter();
    vi.spyOn(hermes as unknown as { findBinary: () => Promise<string> }, 'findBinary').mockResolvedValue('/mock/bin/hermes');
    const executeSafeSpy = vi.spyOn(adapterSdk, 'executeSafeCommand').mockResolvedValue({
      stdout: 'OK',
      stderr: '',
      exitCode: 0,
    });

    const promptTree = {
      instanceId: 'inst-hermes-3',
      createdAt: new Date().toISOString(),
      totalEstimatedTokens: { source: 'estimated' as const, value: 10 },
      layers: [],
      finalRawPrompt: 'Run unrestricted',
    };

    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      await hermes.execute({
        runId: 'run-hermes-unrestricted',
        sessionId: 'session-hermes',
        promptTree,
        workspaceDir: process.cwd(),
        abortSignal: new AbortController().signal,
        permissionPolicy: 'unrestricted',
      } as unknown as import('@agentdeck/adapter-sdk').ExecutionContext);

      const lastCallArgs = executeSafeSpy.mock.calls[0]?.[0]?.args || [];
      const flatArgs = lastCallArgs.map((a: string | { value: string; type: string }) => (typeof a === 'string' ? a : a.value));

      expect(flatArgs).toContain('-z');
      expect(flatArgs).toContain('--yolo');
    } finally {
      process.env.NODE_ENV = origEnv;
      executeSafeSpy.mockRestore();
    }
  });

  it('Hermes handles permission_required error classification properly', async () => {
    const hermes = new HermesAdapter();
    vi.spyOn(hermes as unknown as { findBinary: () => Promise<string> }, 'findBinary').mockResolvedValue('/mock/bin/hermes');
    const executeSafeSpy = vi.spyOn(adapterSdk, 'executeSafeCommand').mockResolvedValue({
      stdout: '',
      stderr: 'Error: Command execution approval required for dangerous operation.',
      exitCode: 1,
    });

    const promptTree = {
      instanceId: 'inst-hermes-4',
      createdAt: new Date().toISOString(),
      totalEstimatedTokens: { source: 'estimated' as const, value: 10 },
      layers: [],
      finalRawPrompt: 'Do dangerous action',
    };

    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      await expect(
        hermes.execute({
          runId: 'run-hermes-perm',
          sessionId: 'session-hermes',
          promptTree,
          workspaceDir: process.cwd(),
          abortSignal: new AbortController().signal,
        })
      ).rejects.toThrow(/Hermes permission_required/);
    } finally {
      process.env.NODE_ENV = origEnv;
      executeSafeSpy.mockRestore();
    }
  });

  it('Hermes handles hook_consent_required error classification properly', async () => {
    const hermes = new HermesAdapter();
    vi.spyOn(hermes as unknown as { findBinary: () => Promise<string> }, 'findBinary').mockResolvedValue('/mock/bin/hermes');
    const executeSafeSpy = vi.spyOn(adapterSdk, 'executeSafeCommand').mockResolvedValue({
      stdout: '',
      stderr: 'Unseen hook not approved. Run with prompt or accept-hooks.',
      exitCode: 1,
    });

    const promptTree = {
      instanceId: 'inst-hermes-5',
      createdAt: new Date().toISOString(),
      totalEstimatedTokens: { source: 'estimated' as const, value: 10 },
      layers: [],
      finalRawPrompt: 'Trigger hook',
    };

    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      await expect(
        hermes.execute({
          runId: 'run-hermes-hook',
          sessionId: 'session-hermes',
          promptTree,
          workspaceDir: process.cwd(),
          abortSignal: new AbortController().signal,
        })
      ).rejects.toThrow(/Hermes hook_consent_required/);
    } finally {
      process.env.NODE_ENV = origEnv;
      executeSafeSpy.mockRestore();
    }
  });

  it('ClaudeCodeAdapter must NOT contain --dangerously-skip-permissions by default', async () => {
    const claude = new ClaudeCodeAdapter();
    vi.spyOn(claude as unknown as { findBinary: () => Promise<string> }, 'findBinary').mockResolvedValue('/mock/bin/claude');
    const executeSafeSpy = vi.spyOn(adapterSdk, 'executeSafeCommand').mockResolvedValue({
      stdout: 'OK',
      stderr: '',
      exitCode: 0,
    });

    const promptTree = {
      instanceId: 'inst-claude-1',
      createdAt: new Date().toISOString(),
      totalEstimatedTokens: { source: 'estimated' as const, value: 10 },
      layers: [],
      finalRawPrompt: 'Safe claude turn',
    };

    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      await claude.execute({
        runId: 'run-claude-safe',
        sessionId: 'session-claude',
        promptTree,
        workspaceDir: process.cwd(),
        abortSignal: new AbortController().signal,
      });

      const lastCallArgs = executeSafeSpy.mock.calls[0]?.[0]?.args || [];
      const flatArgs = lastCallArgs.map((a: string | { value: string; type: string }) => (typeof a === 'string' ? a : a.value));

      expect(flatArgs).toContain('-p');
      expect(flatArgs).not.toContain('--dangerously-skip-permissions');
    } finally {
      process.env.NODE_ENV = origEnv;
      executeSafeSpy.mockRestore();
    }
  });
});

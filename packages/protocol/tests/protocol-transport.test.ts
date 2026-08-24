import { describe, it, expect } from 'vitest';
import {
  AgentTransportKindSchema,
  AgentTurnRequestSchema,
  AgentTurnResultSchema,
} from '../src/index.js';

describe('Protocol Normalization & Schemas', () => {
  it('validates AgentTransportKind enum values', () => {
    const kinds = ['cli-argv', 'cli-stdin', 'cli-json', 'json-rpc', 'http', 'mock'];
    for (const kind of kinds) {
      expect(AgentTransportKindSchema.parse(kind)).toBe(kind);
    }
    expect(() => AgentTransportKindSchema.parse('invalid-kind')).toThrow();
  });

  it('validates AgentTurnRequestSchema with normalized fields', () => {
    const validRequest = {
      runId: 'run-123',
      sessionId: 'session-456',
      instanceId: 'inst-789',
      roomId: 'room-1',
      messages: [
        { role: 'user', content: 'Hello agent!' },
        { role: 'assistant', content: 'Hello human!' },
      ],
      promptTree: {
        instanceId: 'inst-789',
        createdAt: new Date().toISOString(),
        totalEstimatedTokens: { source: 'estimated', value: 40 },
        layers: [
          {
            id: 'layer-1',
            order: 1,
            layerName: 'Trigger Message',
            source: 'User Input',
            content: 'Hello agent!',
            tokenCount: { source: 'estimated', value: 10 },
            redacted: false,
          },
        ],
        finalRawPrompt: 'Hello agent!',
      },
      transport: 'cli-stdin',
    };

    const parsed = AgentTurnRequestSchema.parse(validRequest);
    expect(parsed.runId).toBe('run-123');
    expect(parsed.transport).toBe('cli-stdin');
    expect(parsed.messages.length).toBe(2);
  });

  it('validates AgentTurnResultSchema with usage and exitCode', () => {
    const validResult = {
      content: 'Here is your answer.',
      rawStdout: 'Here is your answer.',
      rawStderr: '',
      exitCode: 0,
      transport: 'cli-argv',
      tokensUsed: {
        input: { source: 'estimated', value: 15 },
        output: { source: 'estimated', value: 25 },
        total: { source: 'estimated', value: 40 },
      },
      costUSD: { source: 'estimated', value: 0.0002 },
      diagnostics: ['Process executed successfully'],
    };

    const parsed = AgentTurnResultSchema.parse(validResult);
    expect(parsed.exitCode).toBe(0);
    expect(parsed.content).toBe('Here is your answer.');
    expect(parsed.transport).toBe('cli-argv');
  });
});

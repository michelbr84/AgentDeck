import { describe, it, expect } from 'vitest';
import {
  AgentCapabilitiesSchema,
  AgentInstallationStateSchema,
  EventEnvelopeSchema,
  PersonaSchema,
} from '../src/index.js';

describe('@agentdeck/protocol schema validation', () => {
  it('should validate capabilities with safe defaults', () => {
    const parsed = AgentCapabilitiesSchema.parse({});
    expect(parsed.install).toBe(false);
    expect(parsed.healthCheck).toBe(true);
    expect(parsed.promptOverlaySupported).toBe(true);
  });

  it('should validate multi-dimensional agent state', () => {
    const validState = {
      availability: 'available',
      installation: 'installed',
      configuration: 'configured',
      authentication: 'authenticated',
      health: 'healthy',
      version: 'current',
      runtime: 'running',
    };
    const parsed = AgentInstallationStateSchema.parse(validState);
    expect(parsed.health).toBe('healthy');
  });

  it('should validate persona overlays', () => {
    const persona = {
      id: 'persona-1',
      name: 'Atlas',
      role: 'Senior Developer',
      language: 'pt-BR',
      systemPromptOverlay: 'Focus on clean architecture',
      avatarEmoji: '🧠',
      isTemplate: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const parsed = PersonaSchema.parse(persona);
    expect(parsed.language).toBe('pt-BR');
  });

  it('should validate event envelopes with metadata', () => {
    const event = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'agent:detected',
      version: 1,
      timestamp: new Date().toISOString(),
      correlationId: 'corr-123',
      payload: { definitionId: 'claude-code', version: '2.1.0' },
    };
    const parsed = EventEnvelopeSchema.parse(event);
    expect(parsed.correlationId).toBe('corr-123');
  });
});

import { describe, it, expect } from 'vitest';
import { PromptComposer } from '../src/prompt-composer.js';
import { Persona } from '@agentdeck/protocol';

describe('@agentdeck/core PromptComposer', () => {
  const persona: Persona = {
    id: 'p-atlas',
    name: 'Atlas',
    role: 'Lead Architect',
    language: 'pt-BR',
    systemPromptOverlay: 'Focus on high performance and clean architecture.',
    avatarEmoji: '🏛️',
    isTemplate: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('should assemble all 8 deterministic layers in proper order', () => {
    const composer = new PromptComposer();
    const tree = composer.compose({
      instanceId: 'inst-1',
      persona,
      globalPolicy: 'Global safety and brevity policy',
      workspaceContext: '/workspace/project-alpha',
      roomInstructions: 'Mention mode only. Max turns: 10.',
      adapterInstructions: 'Use JSON tool calling format.',
      history: [
        {
          id: 'm1',
          roomId: 'r1',
          senderType: 'user',
          senderId: 'u1',
          senderDisplayName: 'Michel',
          content: 'Hello team',
          contentType: 'text',
          createdAt: new Date().toISOString(),
        },
      ],
      triggerMessage: 'Design the microservice persistence layer.',
    });

    expect(tree.instanceId).toBe('inst-1');
    expect(tree.layers.length).toBe(8);
    expect(tree.layers[0]?.layerName).toBe('Global Policy');
    expect(tree.layers[1]?.layerName).toBe('Workspace Context');
    expect(tree.layers[2]?.layerName).toBe('Room Rules');
    expect(tree.layers[3]?.layerName).toBe('Persona Overlay');
    expect(tree.layers[4]?.layerName).toBe('Adapter Tuning');
    expect(tree.layers[5]?.layerName).toBe('Language Constraint');
    expect(tree.layers[6]?.layerName).toBe('Conversation History');
    expect(tree.layers[7]?.layerName).toBe('Trigger Message');

    expect(tree.finalRawPrompt).toContain('Language Requirement: You must answer all user requests strictly in "pt-BR"');
    expect(tree.finalRawPrompt).toContain('You are Atlas, acting as Lead Architect.');
    expect(tree.totalEstimatedTokens.value).toBeGreaterThan(10);
  });

  it('should redact secrets when redact is true', () => {
    const composer = new PromptComposer();
    const tree = composer.compose({
      instanceId: 'inst-1',
      persona,
      triggerMessage: 'My OpenAI key is sk-1234567890abcdef1234567890 and my secret is supersecret123',
      redact: true,
    });

    expect(tree.finalRawPrompt).not.toContain('sk-1234567890abcdef1234567890');
    expect(tree.finalRawPrompt).toContain('[REDACTED_SECRET]');
  });
});

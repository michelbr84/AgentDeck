import { Persona, PromptCompositionTree, PromptLayer, Message } from '@agentdeck/protocol';
import { redactSecrets } from '@agentdeck/security';

export interface PromptCompositionOptions {
  instanceId: string;
  persona: Persona;
  globalPolicy?: string;
  workspaceContext?: string;
  roomInstructions?: string;
  /** Per-turn orchestration directive (debate role, coordinator phase, ...). */
  turnDirective?: string;
  adapterInstructions?: string;
  history?: Message[];
  triggerMessage: string;
  redact?: boolean;
}

export class PromptComposer {
  /**
   * Constructs a structured prompt composition tree with clear layer provenance.
   */
  public compose(options: PromptCompositionOptions): PromptCompositionTree {
    const layers: PromptLayer[] = [];
    let order = 1;

    // 1. Global Policy
    if (options.globalPolicy) {
      layers.push({
        id: `layer-${order}`,
        order: order++,
        layerName: 'Global Policy',
        source: 'AgentDeck Core',
        content: options.globalPolicy.trim(),
        tokenCount: { source: 'estimated', value: Math.ceil(options.globalPolicy.length / 4) },
        redacted: false,
      });
    }

    // 2. Workspace Context
    if (options.workspaceContext) {
      layers.push({
        id: `layer-${order}`,
        order: order++,
        layerName: 'Workspace Context',
        source: 'Host Environment',
        content: options.workspaceContext.trim(),
        tokenCount: { source: 'estimated', value: Math.ceil(options.workspaceContext.length / 4) },
        redacted: false,
      });
    }

    // 3. Room Rules
    if (options.roomInstructions) {
      layers.push({
        id: `layer-${order}`,
        order: order++,
        layerName: 'Room Rules',
        source: 'Room Configuration',
        content: options.roomInstructions.trim(),
        tokenCount: { source: 'estimated', value: Math.ceil(options.roomInstructions.length / 4) },
        redacted: false,
      });
    }

    // 3.5 Turn Directive (orchestration-phase instructions, e.g. debate role)
    if (options.turnDirective) {
      layers.push({
        id: `layer-${order}`,
        order: order++,
        layerName: 'Turn Directive',
        source: 'Orchestration Engine',
        content: options.turnDirective.trim(),
        tokenCount: { source: 'estimated', value: Math.ceil(options.turnDirective.length / 4) },
        redacted: false,
      });
    }

    // 4. Persona Identity & System Prompt Overlay
    const personaContent = [
      `Identity: You are ${options.persona.name}, acting as ${options.persona.role}.`,
      options.persona.systemPromptOverlay ? `Custom Instructions: ${options.persona.systemPromptOverlay}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    layers.push({
      id: `layer-${order}`,
      order: order++,
      layerName: 'Persona Overlay',
      source: `Persona: ${options.persona.name}`,
      content: personaContent,
      tokenCount: { source: 'estimated', value: Math.ceil(personaContent.length / 4) },
      redacted: false,
    });

    // 5. Adapter Tuning / Native Instructions
    if (options.adapterInstructions) {
      layers.push({
        id: `layer-${order}`,
        order: order++,
        layerName: 'Adapter Tuning',
        source: 'Agent Adapter',
        content: options.adapterInstructions.trim(),
        tokenCount: { source: 'estimated', value: Math.ceil(options.adapterInstructions.length / 4) },
        redacted: false,
      });
    }

    // 6. Language Constraint Directive
    const languageDirective = `Language Requirement: You must answer all user requests strictly in "${options.persona.language}".`;
    layers.push({
      id: `layer-${order}`,
      order: order++,
      layerName: 'Language Constraint',
      source: `Persona Language: ${options.persona.language}`,
      content: languageDirective,
      tokenCount: { source: 'estimated', value: Math.ceil(languageDirective.length / 4) },
      redacted: false,
    });

    // 7. Formatted Conversation History
    if (options.history && options.history.length > 0) {
      const formattedHistory = options.history
        .map((m) => `[${m.senderDisplayName}]: ${m.content}`)
        .join('\n');
      layers.push({
        id: `layer-${order}`,
        order: order++,
        layerName: 'Conversation History',
        source: 'Room Context',
        content: formattedHistory,
        tokenCount: { source: 'estimated', value: Math.ceil(formattedHistory.length / 4) },
        redacted: false,
      });
    }

    // 8. Trigger Message
    layers.push({
      id: `layer-${order}`,
      order: order++,
      layerName: 'Trigger Message',
      source: 'User Input',
      content: options.triggerMessage.trim(),
      tokenCount: { source: 'estimated', value: Math.ceil(options.triggerMessage.length / 4) },
      redacted: false,
    });

    // Apply redactions if requested (for inspector views)
    const finalLayers = options.redact
      ? layers.map((l) => ({ ...l, content: redactSecrets(l.content), redacted: true }))
      : layers;

    const rawPrompt = finalLayers.map((l) => `### ${l.layerName} (${l.source})\n${l.content}`).join('\n\n');
    const totalTokens = finalLayers.reduce((acc, l) => acc + (l.tokenCount?.value || 0), 0);

    return {
      instanceId: options.instanceId,
      createdAt: new Date().toISOString(),
      totalEstimatedTokens: { source: 'estimated', value: totalTokens },
      layers: finalLayers,
      finalRawPrompt: rawPrompt,
    };
  }
}

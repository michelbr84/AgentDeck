import { describe, it, expect } from 'vitest';
import { AgentDeckManager } from '../src/agent-deck-manager.js';
import { AgentDeckDatabase } from '@agentdeck/database';

describe('AgentDeck Setup Wizard & Persona Persistence Regression Tests', () => {
  it('should persist a concrete Persona database row when choosing a template and keeping default prompts', async () => {
    const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);

    const installations = await manager.scanAndSyncInstallations();
    expect(installations.length).toBeGreaterThan(0);
    const inst = installations[0]!;

    const template = {
      id: 'persona-atlas',
      name: 'Atlas',
      role: 'Senior Software Architect & Systems Designer',
      language: 'pt-BR',
      systemPromptOverlay: 'You are Atlas, a senior software architect specializing in distributed systems, clean architecture, security, and scalability.',
      avatarEmoji: '🏛️',
      isTemplate: true,
    };
    const instanceName = 'Atlas Senior Assistant';
    const selectedLang = 'pt-BR';
    const systemPromptOverlay = template.systemPromptOverlay; // Default kept without modification

    // Simulating the wizard action when user keeps default
    const createdPersona = await manager.createPersona({
      name: `${template.name} (${instanceName})`,
      role: template.role,
      language: selectedLang,
      systemPromptOverlay,
      avatarEmoji: template.avatarEmoji,
      isTemplate: false,
    });

    expect(createdPersona.id).toBeDefined();
    expect(createdPersona.id).not.toBe(template.id);

    // Verify row exists in SQLite database
    const personaInDb = await manager.getPersona(createdPersona.id);
    expect(personaInDb).toBeDefined();
    expect(personaInDb?.name).toBe(`${template.name} (${instanceName})`);
    expect(personaInDb?.systemPromptOverlay).toBe(template.systemPromptOverlay);

    // Create AgentInstance referencing this persisted persona
    const createdInstance = await manager.createAgentInstance({
      installationId: inst.id,
      personaId: createdPersona.id,
      name: instanceName,
      permissionTier: 'developer',
    });

    expect(createdInstance.id).toBeDefined();
    expect(createdInstance.personaId).toBe(createdPersona.id);

    // Verify joined instance fetch
    const list = await manager.listAgentInstances();
    const found = list.find((i) => i.id === createdInstance.id);
    expect(found).toBeDefined();
    expect(found?.persona.id).toBe(createdPersona.id);
    expect(found?.persona.name).toBe(`${template.name} (${instanceName})`);
    expect(found?.installation.definitionId).toBe(inst.definitionId);

    db.close();
  });

  it('should allow reusing existing persisted personas without duplication', async () => {
    const db = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await db.migrate();
    const manager = AgentDeckManager.createWithDatabase(db);

    const installations = await manager.scanAndSyncInstallations();
    const inst1 = installations[0]!;
    const inst2 = installations[1]!;

    const sharedPersona = await manager.createPersona({
      name: 'Shared QA Lead',
      role: 'Lead QA Engineer',
      language: 'en-US',
      systemPromptOverlay: 'Write comprehensive tests and check edge cases.',
      avatarEmoji: '🧪',
      isTemplate: false,
    });

    // Configure instance 1 with shared persona
    const instance1 = await manager.createAgentInstance({
      installationId: inst1.id,
      personaId: sharedPersona.id,
      name: 'QA Claude',
    });

    // Configure instance 2 with the same existing persona
    const instance2 = await manager.createAgentInstance({
      installationId: inst2.id,
      personaId: sharedPersona.id,
      name: 'QA Hermes',
    });

    expect(instance1.personaId).toBe(sharedPersona.id);
    expect(instance2.personaId).toBe(sharedPersona.id);

    const allPersonas = await manager.listPersonas();
    expect(allPersonas.filter((p) => p.name === 'Shared QA Lead').length).toBe(1);

    db.close();
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentDeckDatabase } from '../src/index.js';

describe('@agentdeck/database initialization & migrations', () => {
  let dbInstance: AgentDeckDatabase;

  beforeEach(async () => {
    dbInstance = new AgentDeckDatabase({ dbPath: ':memory:', inMemory: true });
    await dbInstance.migrate();
  });

  afterEach(() => {
    dbInstance.close();
  });

  it('should pass SQLite integrity check', async () => {
    const check = await dbInstance.integrityCheck();
    expect(check.ok).toBe(true);
  });

  it('should insert and retrieve agent installation and personas safely', async () => {
    await dbInstance.db
      .insertInto('agent_installations')
      .values({
        id: 'inst-claude',
        definition_id: 'claude-code',
        install_method: 'npm',
        availability: 'available',
        installation_state: 'installed',
        configuration_state: 'configured',
        authentication_state: 'authenticated',
        health_state: 'healthy',
        version_state: 'current',
        runtime_state: 'stopped',
        last_checked_at: new Date().toISOString(),
        metadata_json: '{}',
      })
      .execute();

    await dbInstance.db
      .insertInto('personas')
      .values({
        id: 'pers-atlas',
        name: 'Atlas',
        role: 'Senior Architect',
        language: 'pt-BR',
        system_prompt: 'Be concise',
        avatar: '🧠',
        is_template: 0,
      })
      .execute();

    await dbInstance.db
      .insertInto('agent_instances')
      .values({
        id: 'agent-1',
        installation_id: 'inst-claude',
        persona_id: 'pers-atlas',
        name: 'Atlas Claude',
        permission_tier: 'developer',
        is_active: 1,
      })
      .execute();

    const instances = await dbInstance.db.selectFrom('agent_instances').selectAll().execute();
    expect(instances).toHaveLength(1);
    expect(instances[0]?.name).toBe('Atlas Claude');
  });

  it('should enforce foreign key cascades and PRAGMAs', async () => {
    // 1. Insert installation
    await dbInstance.db
      .insertInto('agent_installations')
      .values({
        id: 'inst-test-cascade',
        definition_id: 'claude-code',
        install_method: 'npm',
        availability: 'available',
        installation_state: 'installed',
        configuration_state: 'configured',
        authentication_state: 'authenticated',
        health_state: 'healthy',
        version_state: 'current',
        runtime_state: 'stopped',
        last_checked_at: new Date().toISOString(),
        metadata_json: '{}',
      })
      .execute();

    // 2. Insert persona
    await dbInstance.db
      .insertInto('personas')
      .values({
        id: 'pers-test-cascade',
        name: 'Test Persona',
        role: 'Tester',
        language: 'en-US',
        system_prompt: 'Test',
        avatar: '🧪',
        is_template: 0,
      })
      .execute();

    // 3. Insert instance referencing installation and persona
    await dbInstance.db
      .insertInto('agent_instances')
      .values({
        id: 'agent-cascade-1',
        installation_id: 'inst-test-cascade',
        persona_id: 'pers-test-cascade',
        name: 'Cascade Agent',
        permission_tier: 'developer',
        is_active: 1,
      })
      .execute();

    let instances = await dbInstance.db.selectFrom('agent_instances').selectAll().where('id', '=', 'agent-cascade-1').execute();
    expect(instances).toHaveLength(1);

    // 4. Delete parent installation -> should cascade delete agent instance
    await dbInstance.db.deleteFrom('agent_installations').where('id', '=', 'inst-test-cascade').execute();
    instances = await dbInstance.db.selectFrom('agent_instances').selectAll().where('id', '=', 'agent-cascade-1').execute();
    expect(instances).toHaveLength(0);
  });
});

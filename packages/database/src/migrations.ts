import { Kysely, sql } from 'kysely';

export interface Migration {
  version: number;
  name: string;
  up: (db: Kysely<unknown>) => Promise<void>;
  down: (db: Kysely<unknown>) => Promise<void>;
}

export const initialMigration: Migration = {
  version: 1,
  name: '001_initial_schema',
  up: async (db) => {
    // 1. Agent Installations
    await db.schema
      .createTable('agent_installations')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('definition_id', 'text', (col) => col.notNull())
      .addColumn('binary_path', 'text')
      .addColumn('install_method', 'text', (col) => col.notNull().defaultTo('unknown'))
      .addColumn('version_installed', 'text')
      .addColumn('version_latest', 'text')
      .addColumn('availability', 'text', (col) => col.notNull().defaultTo('available'))
      .addColumn('installation_state', 'text', (col) => col.notNull().defaultTo('not_installed'))
      .addColumn('configuration_state', 'text', (col) => col.notNull().defaultTo('unconfigured'))
      .addColumn('authentication_state', 'text', (col) => col.notNull().defaultTo('unknown'))
      .addColumn('health_state', 'text', (col) => col.notNull().defaultTo('unknown'))
      .addColumn('version_state', 'text', (col) => col.notNull().defaultTo('unknown'))
      .addColumn('runtime_state', 'text', (col) => col.notNull().defaultTo('stopped'))
      .addColumn('last_checked_at', 'text', (col) => col.notNull())
      .addColumn('metadata_json', 'text', (col) => col.notNull().defaultTo('{}'))
      .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // 2. Personas
    await db.schema
      .createTable('personas')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('role', 'text', (col) => col.notNull())
      .addColumn('language', 'text', (col) => col.notNull().defaultTo('en-US'))
      .addColumn('system_prompt', 'text', (col) => col.notNull().defaultTo(''))
      .addColumn('avatar', 'text', (col) => col.notNull().defaultTo('🤖'))
      .addColumn('response_style', 'text')
      .addColumn('is_template', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // 3. Agent Instances
    await db.schema
      .createTable('agent_instances')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('installation_id', 'text', (col) => col.notNull().references('agent_installations.id').onDelete('cascade'))
      .addColumn('persona_id', 'text', (col) => col.notNull().references('personas.id').onDelete('restrict'))
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('model_alias', 'text')
      .addColumn('workspace_dir', 'text')
      .addColumn('permission_tier', 'text', (col) => col.notNull().defaultTo('developer'))
      .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // 4. Users (LocalProfile and RemoteUser)
    await db.schema
      .createTable('users')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('type', 'text', (col) => col.notNull().defaultTo('local_profile'))
      .addColumn('display_name', 'text', (col) => col.notNull())
      .addColumn('avatar', 'text', (col) => col.notNull().defaultTo('👤'))
      .addColumn('email', 'text')
      .addColumn('public_key', 'text')
      .addColumn('preferences_json', 'text', (col) => col.notNull().defaultTo('{}'))
      .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // 5. Rooms
    await db.schema
      .createTable('rooms')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('description', 'text', (col) => col.notNull().defaultTo(''))
      .addColumn('mode', 'text', (col) => col.notNull().defaultTo('mention'))
      .addColumn('turn_limit', 'integer', (col) => col.notNull().defaultTo(10))
      .addColumn('runtime_limit_sec', 'integer', (col) => col.notNull().defaultTo(600))
      .addColumn('cost_limit_usd', 'real')
      .addColumn('workspace_path', 'text')
      .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .addColumn('updated_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // 6. Room Members
    await db.schema
      .createTable('room_members')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('room_id', 'text', (col) => col.notNull().references('rooms.id').onDelete('cascade'))
      .addColumn('member_type', 'text', (col) => col.notNull())
      .addColumn('member_id', 'text', (col) => col.notNull())
      .addColumn('role', 'text', (col) => col.notNull().defaultTo('participant'))
      .addColumn('joined_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // 7. Messages
    await db.schema
      .createTable('messages')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('room_id', 'text', (col) => col.notNull().references('rooms.id').onDelete('cascade'))
      .addColumn('thread_id', 'text')
      .addColumn('sender_type', 'text', (col) => col.notNull())
      .addColumn('sender_id', 'text', (col) => col.notNull())
      .addColumn('sender_display_name', 'text', (col) => col.notNull())
      .addColumn('content', 'text', (col) => col.notNull())
      .addColumn('content_type', 'text', (col) => col.notNull().defaultTo('text'))
      .addColumn('turn_index', 'integer')
      .addColumn('raw_payload_json', 'text')
      .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // 8. Orchestration Runs
    await db.schema
      .createTable('orchestration_runs')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('room_id', 'text', (col) => col.notNull().references('rooms.id').onDelete('cascade'))
      .addColumn('trigger_message_id', 'text')
      .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
      .addColumn('turns_executed', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('tokens_used_json', 'text', (col) => col.notNull().defaultTo('{}'))
      .addColumn('cost_usd_json', 'text', (col) => col.notNull().defaultTo('{}'))
      .addColumn('started_at', 'text', (col) => col.notNull())
      .addColumn('finished_at', 'text')
      .execute();

    // 9. Audit Logs
    await db.schema
      .createTable('audit_logs')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('event_type', 'text', (col) => col.notNull())
      .addColumn('actor_type', 'text', (col) => col.notNull())
      .addColumn('actor_id', 'text', (col) => col.notNull())
      .addColumn('action', 'text', (col) => col.notNull())
      .addColumn('resource', 'text', (col) => col.notNull())
      .addColumn('status', 'text', (col) => col.notNull())
      .addColumn('details_json', 'text', (col) => col.notNull().defaultTo('{}'))
      .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // 10. Backups
    await db.schema
      .createTable('backups')
      .ifNotExists()
      .addColumn('id', 'text', (col) => col.primaryKey())
      .addColumn('agent_definition_id', 'text', (col) => col.notNull())
      .addColumn('backup_path', 'text', (col) => col.notNull())
      .addColumn('version_before', 'text', (col) => col.notNull())
      .addColumn('metadata_json', 'text', (col) => col.notNull().defaultTo('{}'))
      .addColumn('created_at', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();

    // Indexes for high performance queries
    await db.schema.createIndex('idx_messages_room_created').on('messages').columns(['room_id', 'created_at']).execute();
    await db.schema.createIndex('idx_instances_installation').on('agent_instances').column('installation_id').execute();
    await db.schema.createIndex('idx_members_room').on('room_members').column('room_id').execute();
    await db.schema.createIndex('idx_runs_room').on('orchestration_runs').column('room_id').execute();
  },
  down: async (db) => {
    await db.schema.dropTable('backups').ifExists().execute();
    await db.schema.dropTable('audit_logs').ifExists().execute();
    await db.schema.dropTable('orchestration_runs').ifExists().execute();
    await db.schema.dropTable('messages').ifExists().execute();
    await db.schema.dropTable('room_members').ifExists().execute();
    await db.schema.dropTable('rooms').ifExists().execute();
    await db.schema.dropTable('users').ifExists().execute();
    await db.schema.dropTable('agent_instances').ifExists().execute();
    await db.schema.dropTable('personas').ifExists().execute();
    await db.schema.dropTable('agent_installations').ifExists().execute();
  },
};

export const v104Migration: Migration = {
  version: 2,
  name: '002_v1_0_4_routing_and_management',
  up: async (db) => {
    // 1. Add is_active column to agent_instances
    try {
      await db.schema
        .alterTable('agent_instances')
        .addColumn('is_active', 'integer', (col) => col.notNull().defaultTo(1))
        .execute();
    } catch {
      // Column might already exist
    }

    // 2. Add default_agent_instance_id to rooms
    try {
      await db.schema
        .alterTable('rooms')
        .addColumn('default_agent_instance_id', 'text')
        .execute();
    } catch {
      // Column might already exist
    }

    // 3. Add delivery_trace_json to messages
    try {
      await db.schema
        .alterTable('messages')
        .addColumn('delivery_trace_json', 'text')
        .execute();
    } catch {
      // Column might already exist
    }
  },
  down: async () => {
    // SQLite doesn't strictly support drop column easily without table recreation in older versions,
    // so down migration keeps schema backwards compatible.
  },
};


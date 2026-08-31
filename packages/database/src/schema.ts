import { Generated } from 'kysely';

export interface AgentInstallationsTable {
  id: string;
  definition_id: string;
  binary_path: string | null;
  install_method: string;
  version_installed: string | null;
  version_latest: string | null;
  availability: string;
  installation_state: string;
  configuration_state: string;
  authentication_state: string;
  health_state: string;
  version_state: string;
  runtime_state: string;
  last_checked_at: string;
  metadata_json: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface PersonasTable {
  id: string;
  name: string;
  role: string;
  language: string;
  system_prompt: string;
  avatar: string;
  response_style: string | null;
  is_template: number; // 0 or 1
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface AgentInstancesTable {
  id: string;
  installation_id: string;
  persona_id: string;
  name: string;
  model_alias: string | null;
  workspace_dir: string | null;
  permission_tier: string;
  is_active: number; // 1 = active, 0 = disabled/archived
  /** JSON LlmRouting overriding the deck-wide default. Null = inherit. */
  llm_override_json: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface UsersTable {
  id: string;
  type: string; // 'local_profile' | 'remote_user'
  display_name: string;
  avatar: string;
  email: string | null;
  public_key: string | null;
  preferences_json: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface RoomsTable {
  id: string;
  name: string;
  description: string;
  mode: string; // 'mention' | 'panel' | 'debate' | 'round_robin' | 'coordinator'
  default_agent_instance_id: string | null;
  turn_limit: number;
  runtime_limit_sec: number;
  cost_limit_usd: number | null;
  turn_timeout_sec: number | null;
  workspace_path: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface RoomMembersTable {
  id: string;
  room_id: string;
  member_type: string; // 'agent_instance' | 'user'
  member_id: string;
  role: string;
  joined_at: Generated<string>;
}

export interface MessagesTable {
  id: string;
  room_id: string;
  thread_id: string | null;
  sender_type: string;
  sender_id: string;
  sender_display_name: string;
  content: string;
  content_type: string;
  turn_index: number | null;
  delivery_trace_json: string | null;
  raw_payload_json: string | null;
  created_at: Generated<string>;
}

export interface OrchestrationRunsTable {
  id: string;
  room_id: string;
  trigger_message_id: string | null;
  status: string; // 'pending' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'
  turns_executed: number;
  tokens_used_json: string;
  cost_usd_json: string;
  started_at: string;
  finished_at: string | null;
}

export interface AuditLogsTable {
  id: string;
  event_type: string;
  actor_type: string;
  actor_id: string;
  action: string;
  resource: string;
  status: string;
  details_json: string;
  created_at: Generated<string>;
}

export interface BackupsTable {
  id: string;
  agent_definition_id: string;
  backup_path: string;
  version_before: string;
  metadata_json: string;
  created_at: Generated<string>;
}

/** Singleton table: exactly one row, id `'default'`. */
export interface LlmRoutingTable {
  id: string;
  primary_json: string;
  backup_json: string | null;
  updated_at: string;
}

export interface DatabaseSchema {
  agent_installations: AgentInstallationsTable;
  personas: PersonasTable;
  agent_instances: AgentInstancesTable;
  users: UsersTable;
  rooms: RoomsTable;
  room_members: RoomMembersTable;
  messages: MessagesTable;
  orchestration_runs: OrchestrationRunsTable;
  audit_logs: AuditLogsTable;
  backups: BackupsTable;
  llm_routing: LlmRoutingTable;
}

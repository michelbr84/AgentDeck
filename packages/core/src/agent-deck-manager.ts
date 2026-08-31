import { AgentDeckDatabase, createDatabase, sql } from '@agentdeck/database';
import { EventBus } from './event-bus.js';
import { PromptComposer } from './prompt-composer.js';
import { TransactionalUpgradeEngine } from './upgrade-engine.js';
import { MultiAgentOrchestrationEngine } from './orchestration-engine.js';
import {
  ClaudeCodeAdapter,
  HermesAdapter,
  OpenClawAdapter,
  GarraIAAdapter,
  PiAdapter,
  KiloAdapter,
  ClineAdapter,
  CodexAdapter,
} from '@agentdeck/adapters';
import { AgentAdapter } from '@agentdeck/adapter-sdk';
import { PluginLoader } from './plugin-loader.js';
import {
  AgentInstallation,
  AgentInstance,
  Persona,
  UserProfile,
  Room,
  Message,
  MessagePage,
  HealthCheckLevel,
  HealthReport,
  ChatDeliveryTrace,
} from '@agentdeck/protocol';
import { ensureSecureDirectory } from '@agentdeck/security';
import { RunAbortError } from './run-control.js';
import path from 'node:path';
import os from 'node:os';
import { isOutdated as isVersionOutdated } from '@agentdeck/adapters';

export interface ManagerOptions {
  db?: AgentDeckDatabase;
  eventBus?: EventBus;
}

export interface GetRoomMessagesOptions {
  limit?: number;
  /** Opaque cursor — return only messages strictly OLDER than this position. */
  before?: string;
  /** Opaque cursor — return only messages strictly NEWER than this position. */
  after?: string;
}

/**
 * SQLite's CURRENT_TIMESTAMP default stored `YYYY-MM-DD HH:MM:SS` (UTC, second
 * granularity). New writes keep that shape but append milliseconds, so plain
 * string ordering stays correct across legacy and new rows — an ISO `T`
 * separator would sort AFTER every legacy timestamp of the same day.
 */
function sqliteTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * Messages posted within the same clock millisecond would otherwise tie on
 * created_at and fall back to the random id suffix, scrambling display order.
 * A per-process monotonic clock guarantees each post gets a strictly greater
 * timestamp (drifting at most a few ms ahead under bursts).
 */
let lastMessageTimestampMs = 0;
function nextMessageDate(): Date {
  const now = Date.now();
  lastMessageTimestampMs = now > lastMessageTimestampMs ? now : lastMessageTimestampMs + 1;
  return new Date(lastMessageTimestampMs);
}

/** Normalizes a stored timestamp (either shape) back to ISO-8601 UTC. */
function isoTimestamp(raw: string): string {
  return raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`;
}

interface MessageCursor {
  createdAt: string;
  turnIndex: number;
  id: string;
}

interface MessageRow {
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
  created_at: string;
}

function encodeMessageCursor(cursor: MessageCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.turnIndex, cursor.id]), 'utf8').toString('base64url');
}

function decodeMessageCursor(cursor: string): MessageCursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'number' &&
      typeof parsed[2] === 'string'
    ) {
      return { createdAt: parsed[0], turnIndex: parsed[1], id: parsed[2] };
    }
  } catch {
    // fall through to the shared error below
  }
  throw Object.assign(new Error('Invalid message cursor'), { statusCode: 400, code: 'INVALID_CURSOR' });
}

export class AgentDeckManager {
  public readonly db: AgentDeckDatabase;
  public readonly eventBus: EventBus;
  public readonly promptComposer: PromptComposer;
  public readonly upgradeEngine: TransactionalUpgradeEngine;
  public readonly orchestrationEngine: MultiAgentOrchestrationEngine;

  private adapterRegistry = new Map<string, AgentAdapter>();

  /** Live orchestration runs, so REST/WS/UIs can reach a run's abort signal. */
  private activeRuns = new Map<string, { controller: AbortController; roomId: string }>();

  private constructor(db: AgentDeckDatabase, eventBus?: EventBus) {
    this.db = db;
    this.eventBus = eventBus || new EventBus();
    this.promptComposer = new PromptComposer();
    this.upgradeEngine = new TransactionalUpgradeEngine(this.eventBus);
    this.orchestrationEngine = new MultiAgentOrchestrationEngine(this);

    // Register built-in default adapters
    this.registerAdapter(new ClaudeCodeAdapter());
    this.registerAdapter(new HermesAdapter());
    this.registerAdapter(new OpenClawAdapter());
    this.registerAdapter(new GarraIAAdapter());
    this.registerAdapter(new PiAdapter());
    this.registerAdapter(new KiloAdapter());
    this.registerAdapter(new ClineAdapter());
    this.registerAdapter(new CodexAdapter());
  }

  public async loadExternalPlugins(pluginsDir?: string): Promise<void> {
    const loader = new PluginLoader(pluginsDir);
    const plugins = await loader.loadAllPlugins();
    for (const p of plugins) {
      this.registerAdapter(p);
    }
  }

  public static async create(customDbPath?: string, customPluginsDir?: string): Promise<AgentDeckManager> {
    const dbPath = customDbPath || path.join(os.homedir(), '.agentdeck', 'data', 'agentdeck.db');
    await ensureSecureDirectory(path.dirname(dbPath));
    const db = await createDatabase(dbPath);
    const mgr = new AgentDeckManager(db);
    try {
      await mgr.loadExternalPlugins(customPluginsDir);
    } catch {
      // plugin directory may not exist yet
    }
    return mgr;
  }

  public static createWithDatabase(db: AgentDeckDatabase, bus?: EventBus): AgentDeckManager {
    return new AgentDeckManager(db, bus);
  }

  public registerAdapter(adapter: AgentAdapter): void {
    this.adapterRegistry.set(adapter.definition.id, adapter);
  }

  public getAdapter(definitionId: string): AgentAdapter | undefined {
    return this.adapterRegistry.get(definitionId);
  }

  public getAllAdapters(): AgentAdapter[] {
    return Array.from(this.adapterRegistry.values());
  }

  public async listPlugins(): Promise<AgentAdapter[]> {
    return Array.from(this.adapterRegistry.values());
  }

  /**
   * Scans system for all registered agent adapters, updates database state, and returns installations.
   */
  public async scanAndSyncInstallations(): Promise<AgentInstallation[]> {
    const results: AgentInstallation[] = [];

    for (const adapter of this.getAllAdapters()) {
      const detection = await adapter.detect();
      const latest = await adapter.getLatestVersion();

      const existing = await this.db.db
        .selectFrom('agent_installations')
        .selectAll()
        .where('definition_id', '=', adapter.definition.id)
        .executeTakeFirst();

      const id = existing?.id || `inst-${adapter.definition.id}`;
      // Semver, not string equality: `"garra 0.3.4"` vs `"0.3.4"` and `"0.10.0"`
      // vs `"0.9.0"` both compare wrong lexically, and a false "outdated" pushes
      // the wizard into an upgrade the user never needed.
      const isOutdated =
        detection.installed && isVersionOutdated(detection.version, latest.latestVersion);

      const state = {
        ...detection.state,
        version: isOutdated ? ('outdated' as const) : detection.state.version,
      };

      if (existing) {
        await this.db.db
          .updateTable('agent_installations')
          .set({
            binary_path: detection.binaryPath,
            version_installed: detection.version,
            version_latest: latest.latestVersion,
            availability: state.availability,
            installation_state: state.installation,
            configuration_state: state.configuration,
            authentication_state: state.authentication,
            health_state: state.health,
            version_state: state.version,
            runtime_state: state.runtime,
            last_checked_at: new Date().toISOString(),
          })
          .where('id', '=', existing.id)
          .execute();
      } else {
        await this.db.db
          .insertInto('agent_installations')
          .values({
            id,
            definition_id: adapter.definition.id,
            binary_path: detection.binaryPath,
            install_method: 'native',
            version_installed: detection.version,
            version_latest: latest.latestVersion,
            availability: state.availability,
            installation_state: state.installation,
            configuration_state: state.configuration,
            authentication_state: state.authentication,
            health_state: state.health,
            version_state: state.version,
            runtime_state: state.runtime,
            last_checked_at: new Date().toISOString(),
            metadata_json: JSON.stringify({ description: adapter.definition.description }),
          })
          .execute();
      }

      results.push({
        id,
        definitionId: adapter.definition.id,
        binaryPath: detection.binaryPath,
        installMethod: 'native',
        versionInstalled: detection.version,
        versionLatest: latest.latestVersion,
        state,
        lastCheckedAt: new Date().toISOString(),
        metadata: { description: adapter.definition.description },
      });
    }

    return results;
  }

  /**
   * Runs diagnostic health checks on an agent (Level 1 static or Level 2 connectivity).
   */
  public async checkAgentHealth(definitionId: string, level: HealthCheckLevel = 'level1_static'): Promise<HealthReport> {
    const adapter = this.getAdapter(definitionId);
    if (!adapter) {
      throw new Error(`Agent definition "${definitionId}" not recognized in registry`);
    }

    const report = await adapter.checkHealth(level);
    await this.db.db
      .updateTable('agent_installations')
      .set({
        health_state: report.overallStatus,
        last_checked_at: report.checkedAt,
      })
      .where('definition_id', '=', definitionId)
      .execute();

    return report;
  }

  // ==========================================
  // PERSONA MANAGEMENT
  // ==========================================
  public async listPersonas(): Promise<Persona[]> {
    const rows = await this.db.db.selectFrom('personas').selectAll().execute();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      language: r.language,
      systemPromptOverlay: r.system_prompt,
      avatarEmoji: r.avatar,
      responseStyle: r.response_style || undefined,
      isTemplate: r.is_template === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public async createPersona(persona: Omit<Persona, 'id' | 'createdAt' | 'updatedAt'>): Promise<Persona> {
    const id = `persona-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    await this.db.db
      .insertInto('personas')
      .values({
        id,
        name: persona.name,
        role: persona.role,
        language: persona.language || 'pt-BR',
        system_prompt: persona.systemPromptOverlay || '',
        avatar: persona.avatarEmoji || '🤖',
        response_style: persona.responseStyle || null,
        is_template: persona.isTemplate ? 1 : 0,
      })
      .execute();

    return {
      id,
      ...persona,
      createdAt: now,
      updatedAt: now,
    };
  }

  public async getPersona(id: string): Promise<Persona | null> {
    const r = await this.db.db.selectFrom('personas').selectAll().where('id', '=', id).executeTakeFirst();
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      role: r.role,
      language: r.language,
      systemPromptOverlay: r.system_prompt,
      avatarEmoji: r.avatar,
      responseStyle: r.response_style || undefined,
      isTemplate: r.is_template === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public async updatePersona(id: string, updates: Partial<Persona>): Promise<void> {
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.name !== undefined) patch['name'] = updates.name;
    if (updates.role !== undefined) patch['role'] = updates.role;
    if (updates.language !== undefined) patch['language'] = updates.language;
    if (updates.systemPromptOverlay !== undefined) patch['system_prompt'] = updates.systemPromptOverlay;
    if (updates.avatarEmoji !== undefined) patch['avatar'] = updates.avatarEmoji;
    if (updates.responseStyle !== undefined) patch['response_style'] = updates.responseStyle;
    if (updates.isTemplate !== undefined) patch['is_template'] = updates.isTemplate ? 1 : 0;

    await this.db.db
      .updateTable('personas')
      .set(patch as never)
      .where('id', '=', id)
      .execute();
  }

  public async deletePersona(id: string): Promise<void> {
    const referencingInstances = await this.db.db
      .selectFrom('agent_instances')
      .select(['id', 'name'])
      .where('persona_id', '=', id)
      .where('is_active', '=', 1)
      .execute();

    if (referencingInstances.length > 0) {
      const names = referencingInstances.map((i) => i.name).join(', ');
      const err = new Error(`Cannot delete persona "${id}" because it is in use by active agent instance(s): ${names}`);
      (err as unknown as Record<string, unknown>).code = 'PERSONA_IN_USE';
      (err as unknown as Record<string, unknown>).statusCode = 409;
      throw err;
    }

    await this.db.db.deleteFrom('personas').where('id', '=', id).execute();
  }

  public async duplicatePersona(id: string, newName?: string): Promise<Persona> {
    const source = await this.getPersona(id);
    if (!source) {
      throw new Error(`Persona with ID "${id}" not found`);
    }

    return this.createPersona({
      name: newName || `${source.name} (Copy)`,
      role: source.role,
      language: source.language,
      systemPromptOverlay: source.systemPromptOverlay,
      avatarEmoji: source.avatarEmoji,
      responseStyle: source.responseStyle,
      isTemplate: false,
    });
  }

  // ==========================================
  // AGENT INSTANCE MANAGEMENT
  // ==========================================
  public async listAgentInstances(): Promise<Array<AgentInstance & { persona: Persona; installation: AgentInstallation }>> {
    const rows = await this.db.db
      .selectFrom('agent_instances')
      .innerJoin('personas', 'personas.id', 'agent_instances.persona_id')
      .innerJoin('agent_installations', 'agent_installations.id', 'agent_instances.installation_id')
      .selectAll('agent_instances')
      .select([
        'personas.id as p_id',
        'personas.name as p_name',
        'personas.role as p_role',
        'personas.language as p_language',
        'personas.system_prompt as p_system_prompt',
        'personas.avatar as p_avatar',
        'personas.is_template as p_is_template',
        'personas.created_at as p_created_at',
        'personas.updated_at as p_updated_at',
        'agent_installations.definition_id as inst_def_id',
        'agent_installations.binary_path as inst_bin_path',
        'agent_installations.install_method as inst_method',
        'agent_installations.version_installed as inst_ver_inst',
        'agent_installations.version_latest as inst_ver_latest',
        'agent_installations.availability as inst_avail',
        'agent_installations.installation_state as inst_state',
        'agent_installations.configuration_state as inst_config',
        'agent_installations.authentication_state as inst_auth',
        'agent_installations.health_state as inst_health',
        'agent_installations.version_state as inst_ver_state',
        'agent_installations.runtime_state as inst_runtime',
        'agent_installations.last_checked_at as inst_last_checked',
      ])
      .execute();

    return rows.map((r) => ({
      id: r.id,
      installationId: r.installation_id,
      personaId: r.persona_id,
      name: r.name,
      modelAlias: r.model_alias || undefined,
      workspaceDir: r.workspace_dir || undefined,
      permissionTier: r.permission_tier as 'developer',
      isActive: r.is_active !== 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      persona: {
        id: r.p_id,
        name: r.p_name,
        role: r.p_role,
        language: r.p_language,
        systemPromptOverlay: r.p_system_prompt,
        avatarEmoji: r.p_avatar,
        isTemplate: r.p_is_template === 1,
        createdAt: r.p_created_at,
        updatedAt: r.p_updated_at,
      },
      installation: {
        id: r.installation_id,
        definitionId: r.inst_def_id,
        binaryPath: r.inst_bin_path,
        installMethod: r.inst_method as 'native',
        versionInstalled: r.inst_ver_inst,
        versionLatest: r.inst_ver_latest,
        state: {
          availability: r.inst_avail as 'available',
          installation: r.inst_state as 'installed',
          configuration: r.inst_config as 'configured',
          authentication: r.inst_auth as 'authenticated',
          health: r.inst_health as 'healthy',
          version: r.inst_ver_state as 'current',
          runtime: r.inst_runtime as 'stopped',
        },
        lastCheckedAt: r.inst_last_checked,
        metadata: {},
      },
    }));
  }

  public async createAgentInstance(params: {
    installationId: string;
    personaId: string;
    name: string;
    modelAlias?: string;
    workspaceDir?: string;
    permissionTier?: 'safe' | 'developer' | 'autonomous' | 'custom';
    isActive?: boolean;
  }): Promise<AgentInstance> {
    const id = `instance-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();
    const activeVal = params.isActive !== undefined ? (params.isActive ? 1 : 0) : 1;

    await this.db.db
      .insertInto('agent_instances')
      .values({
        id,
        installation_id: params.installationId,
        persona_id: params.personaId,
        name: params.name,
        model_alias: params.modelAlias || null,
        workspace_dir: params.workspaceDir || null,
        permission_tier: params.permissionTier || 'developer',
        is_active: activeVal,
      })
      .execute();

    return {
      id,
      installationId: params.installationId,
      personaId: params.personaId,
      name: params.name,
      modelAlias: params.modelAlias,
      workspaceDir: params.workspaceDir,
      permissionTier: params.permissionTier || 'developer',
      isActive: activeVal === 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  public async updateAgentInstance(
    id: string,
    updates: {
      name?: string;
      personaId?: string;
      modelAlias?: string | null;
      workspaceDir?: string | null;
      permissionTier?: 'safe' | 'developer' | 'autonomous' | 'custom';
      isActive?: boolean;
    }
  ): Promise<void> {
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.name !== undefined) patch['name'] = updates.name;
    if (updates.personaId !== undefined) patch['persona_id'] = updates.personaId;
    if (updates.modelAlias !== undefined) patch['model_alias'] = updates.modelAlias;
    if (updates.workspaceDir !== undefined) patch['workspace_dir'] = updates.workspaceDir;
    if (updates.permissionTier !== undefined) patch['permission_tier'] = updates.permissionTier;
    if (updates.isActive !== undefined) patch['is_active'] = updates.isActive ? 1 : 0;

    await this.db.db
      .updateTable('agent_instances')
      .set(patch as never)
      .where('id', '=', id)
      .execute();
  }

  public async toggleAgentInstanceActive(id: string, isActive?: boolean): Promise<AgentInstance | null> {
    const existing = await this.db.db
      .selectFrom('agent_instances')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) return null;

    const nextActive = isActive !== undefined ? (isActive ? 1 : 0) : existing.is_active === 1 ? 0 : 1;
    const now = new Date().toISOString();

    await this.db.db
      .updateTable('agent_instances')
      .set({
        is_active: nextActive,
        updated_at: now,
      } as never)
      .where('id', '=', id)
      .execute();

    return {
      id: existing.id,
      installationId: existing.installation_id,
      personaId: existing.persona_id,
      name: existing.name,
      modelAlias: existing.model_alias || undefined,
      workspaceDir: existing.workspace_dir || undefined,
      permissionTier: existing.permission_tier as 'safe' | 'developer' | 'autonomous' | 'custom',
      isActive: nextActive === 1,
      createdAt: existing.created_at,
      updatedAt: now,
    };
  }

  public async deleteAgentInstance(id: string): Promise<void> {
    await this.db.db.deleteFrom('agent_instances').where('id', '=', id).execute();
  }

  // ==========================================
  // USERS & PEOPLE (LOCAL PROFILES)
  // ==========================================
  public async listUsers(): Promise<UserProfile[]> {
    const rows = await this.db.db.selectFrom('users').selectAll().execute();
    return rows.map((r) => ({
      id: r.id,
      type: r.type as 'local_profile',
      displayName: r.display_name,
      avatar: r.avatar,
      email: r.email || undefined,
      publicKey: r.public_key || undefined,
      preferences: JSON.parse(r.preferences_json || '{}'),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public async createOrGetLocalProfile(displayName: string, avatar = '👤'): Promise<UserProfile> {
    const existing = await this.db.db
      .selectFrom('users')
      .selectAll()
      .where('type', '=', 'local_profile')
      .where('display_name', '=', displayName)
      .executeTakeFirst();

    if (existing) {
      return {
        id: existing.id,
        type: 'local_profile',
        displayName: existing.display_name,
        avatar: existing.avatar,
        email: existing.email || undefined,
        publicKey: existing.public_key || undefined,
        preferences: JSON.parse(existing.preferences_json || '{}'),
        createdAt: existing.created_at,
        updatedAt: existing.updated_at,
      };
    }

    const id = `user-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    await this.db.db
      .insertInto('users')
      .values({
        id,
        type: 'local_profile',
        display_name: displayName,
        avatar,
        preferences_json: '{}',
      })
      .execute();

    return {
      id,
      type: 'local_profile',
      displayName,
      avatar,
      preferences: {},
      createdAt: now,
      updatedAt: now,
    };
  }

  // ==========================================
  // ACTIVE RUN REGISTRY (abort controls)
  // ==========================================
  public registerRun(runId: string, roomId: string, controller: AbortController): void {
    this.activeRuns.set(runId, { controller, roomId });
  }

  public unregisterRun(runId: string): void {
    this.activeRuns.delete(runId);
  }

  /** Aborts one run. Returns false when the run is unknown or already done. */
  public abortRun(runId: string): boolean {
    const run = this.activeRuns.get(runId);
    if (!run) return false;
    run.controller.abort(new RunAbortError());
    return true;
  }

  /** Aborts every live run in a room; returns how many were signalled. */
  public abortRoomRuns(roomId: string): number {
    let aborted = 0;
    for (const run of this.activeRuns.values()) {
      if (run.roomId === roomId) {
        run.controller.abort(new RunAbortError());
        aborted++;
      }
    }
    return aborted;
  }

  public hasActiveRunForRoom(roomId: string): boolean {
    for (const run of this.activeRuns.values()) {
      if (run.roomId === roomId) return true;
    }
    return false;
  }

  public listActiveRuns(): Array<{ runId: string; roomId: string }> {
    return Array.from(this.activeRuns.entries(), ([runId, run]) => ({ runId, roomId: run.roomId }));
  }

  // ==========================================
  // ROOMS & MESSAGING
  // ==========================================
  public async listRooms(): Promise<Room[]> {
    const rows = await this.db.db.selectFrom('rooms').selectAll().execute();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      mode: r.mode as 'mention',
      defaultAgentInstanceId: r.default_agent_instance_id || undefined,
      maxTurnsPerRun: r.turn_limit,
      maxRuntimeSec: r.runtime_limit_sec,
      maxCostUSD: r.cost_limit_usd || undefined,
      turnTimeoutSec: r.turn_timeout_sec || undefined,
      workspacePath: r.workspace_path || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public async getRoom(roomId: string): Promise<Room | null> {
    const r = await this.db.db.selectFrom('rooms').selectAll().where('id', '=', roomId).executeTakeFirst();
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      mode: r.mode as 'mention',
      defaultAgentInstanceId: r.default_agent_instance_id || undefined,
      maxTurnsPerRun: r.turn_limit,
      maxRuntimeSec: r.runtime_limit_sec,
      maxCostUSD: r.cost_limit_usd || undefined,
      turnTimeoutSec: r.turn_timeout_sec || undefined,
      workspacePath: r.workspace_path || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public async createRoom(params: {
    name: string;
    description?: string;
    mode?: 'mention' | 'panel' | 'debate' | 'round_robin' | 'coordinator';
    defaultAgentInstanceId?: string | null;
    workspacePath?: string;
    memberInstanceIds?: string[];
    memberUserIds?: string[];
    maxTurnsPerRun?: number;
    maxRuntimeSec?: number;
    maxCostUSD?: number;
    turnTimeoutSec?: number;
  }): Promise<Room> {
    const id = `room-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    await this.db.db
      .insertInto('rooms')
      .values({
        id,
        name: params.name,
        description: params.description || '',
        mode: params.mode || 'mention',
        default_agent_instance_id: params.defaultAgentInstanceId || null,
        turn_limit: params.maxTurnsPerRun ?? 10,
        runtime_limit_sec: params.maxRuntimeSec ?? 600,
        cost_limit_usd: params.maxCostUSD ?? null,
        turn_timeout_sec: params.turnTimeoutSec ?? null,
        workspace_path: params.workspacePath || null,
      })
      .execute();

    // Add members
    if (params.memberUserIds) {
      for (const uid of params.memberUserIds) {
        await this.db.db
          .insertInto('room_members')
          .values({
            id: `rm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            room_id: id,
            member_type: 'user',
            member_id: uid,
            role: 'owner',
          })
          .execute();
      }
    }

    if (params.memberInstanceIds) {
      for (const instId of params.memberInstanceIds) {
        await this.db.db
          .insertInto('room_members')
          .values({
            id: `rm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            room_id: id,
            member_type: 'agent_instance',
            member_id: instId,
            role: 'participant',
          })
          .execute();
      }
    }

    return {
      id,
      name: params.name,
      description: params.description || '',
      mode: params.mode || 'mention',
      defaultAgentInstanceId: params.defaultAgentInstanceId || undefined,
      maxTurnsPerRun: params.maxTurnsPerRun ?? 10,
      maxRuntimeSec: params.maxRuntimeSec ?? 600,
      maxCostUSD: params.maxCostUSD,
      turnTimeoutSec: params.turnTimeoutSec,
      workspacePath: params.workspacePath,
      createdAt: now,
      updatedAt: now,
    };
  }

  public async updateRoom(
    id: string,
    updates: {
      name?: string;
      description?: string;
      mode?: 'mention' | 'panel' | 'debate' | 'round_robin' | 'coordinator';
      defaultAgentInstanceId?: string | null;
      workspacePath?: string | null;
      maxTurnsPerRun?: number;
      maxRuntimeSec?: number;
      maxCostUSD?: number | null;
      turnTimeoutSec?: number | null;
    }
  ): Promise<void> {
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.name !== undefined) patch['name'] = updates.name;
    if (updates.description !== undefined) patch['description'] = updates.description;
    if (updates.mode !== undefined) patch['mode'] = updates.mode;
    if (updates.defaultAgentInstanceId !== undefined) patch['default_agent_instance_id'] = updates.defaultAgentInstanceId;
    if (updates.workspacePath !== undefined) patch['workspace_path'] = updates.workspacePath;
    if (updates.maxTurnsPerRun !== undefined) patch['turn_limit'] = updates.maxTurnsPerRun;
    if (updates.maxRuntimeSec !== undefined) patch['runtime_limit_sec'] = updates.maxRuntimeSec;
    if (updates.maxCostUSD !== undefined) patch['cost_limit_usd'] = updates.maxCostUSD;
    if (updates.turnTimeoutSec !== undefined) patch['turn_timeout_sec'] = updates.turnTimeoutSec;

    await this.db.db
      .updateTable('rooms')
      .set(patch as never)
      .where('id', '=', id)
      .execute();
  }

  public async setDefaultAgentInstanceForRoom(roomId: string, instanceId: string | null): Promise<void> {
    await this.updateRoom(roomId, { defaultAgentInstanceId: instanceId });
  }

  public async listRoomMembers(roomId: string): Promise<Array<{ id: string; memberType: 'agent_instance' | 'user'; memberId: string; role: string }>> {
    const rows = await this.db.db
      .selectFrom('room_members')
      .selectAll()
      .where('room_id', '=', roomId)
      .execute();

    return rows.map((r) => ({
      id: r.id,
      memberType: r.member_type as 'agent_instance' | 'user',
      memberId: r.member_id,
      role: r.role,
    }));
  }

  public async addMemberToRoom(params: {
    roomId: string;
    memberType: 'agent_instance' | 'user';
    memberId: string;
    role?: 'owner' | 'admin' | 'participant' | 'observer';
  }): Promise<{ id: string; roomId: string; memberType: 'agent_instance' | 'user'; memberId: string; role: string; joinedAt: string }> {
    const id = `rm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();
    await this.db.db
      .insertInto('room_members')
      .values({
        id,
        room_id: params.roomId,
        member_type: params.memberType,
        member_id: params.memberId,
        role: params.role || 'participant',
      })
      .execute();

    return {
      id,
      roomId: params.roomId,
      memberType: params.memberType,
      memberId: params.memberId,
      role: params.role || 'participant',
      joinedAt: now,
    };
  }

  public async addRoomMember(
    roomId: string,
    memberType: 'agent_instance' | 'user',
    memberId: string,
    role?: 'owner' | 'admin' | 'participant' | 'observer'
  ): Promise<{ id: string; roomId: string; memberType: 'agent_instance' | 'user'; memberId: string; role: string; joinedAt: string }> {
    return this.addMemberToRoom({ roomId, memberType, memberId, role });
  }

  public async removeRoomMember(roomId: string, memberId: string): Promise<void> {
    return this.removeMemberFromRoom(roomId, memberId);
  }

  public async removeMemberFromRoom(roomId: string, memberId: string): Promise<void> {
    await this.db.db
      .deleteFrom('room_members')
      .where('room_id', '=', roomId)
      .where('member_id', '=', memberId)
      .execute();
  }

  /**
   * Returns the newest window of a room's history in ascending display order.
   * The positional-number form keeps the historical `Message[]` shape; the
   * options form adds keyset pagination (`before` pages older, `after` pages
   * newer) and returns a `MessagePage` envelope. Ordering — and the cursor —
   * is the triple (created_at, turn_index, id) so concurrent same-timestamp
   * turns page without gaps or duplicates.
   */
  public async getRoomMessages(roomId: string, limit?: number): Promise<Message[]>;
  public async getRoomMessages(roomId: string, opts: GetRoomMessagesOptions): Promise<MessagePage>;
  public async getRoomMessages(
    roomId: string,
    opts?: number | GetRoomMessagesOptions
  ): Promise<Message[] | MessagePage> {
    const paged = typeof opts === 'object' && opts !== null;
    const limit = Math.max(1, (paged ? opts.limit : opts) ?? 50);
    const before = paged ? opts.before : undefined;
    const after = paged ? opts.after : undefined;

    const turnIndexExpr = sql<number>`COALESCE(turn_index, -1)`;

    let query = this.db.db.selectFrom('messages').selectAll().where('room_id', '=', roomId);

    if (before) {
      const c = decodeMessageCursor(before);
      query = query.where((eb) =>
        eb.or([
          eb('created_at', '<', c.createdAt),
          eb.and([eb('created_at', '=', c.createdAt), eb(turnIndexExpr, '<', c.turnIndex)]),
          eb.and([
            eb('created_at', '=', c.createdAt),
            eb(turnIndexExpr, '=', c.turnIndex),
            eb('id', '<', c.id),
          ]),
        ])
      );
    }
    if (after) {
      const c = decodeMessageCursor(after);
      query = query.where((eb) =>
        eb.or([
          eb('created_at', '>', c.createdAt),
          eb.and([eb('created_at', '=', c.createdAt), eb(turnIndexExpr, '>', c.turnIndex)]),
          eb.and([
            eb('created_at', '=', c.createdAt),
            eb(turnIndexExpr, '=', c.turnIndex),
            eb('id', '>', c.id),
          ]),
        ])
      );
    }

    // `after` pages forward in ascending order; every other form returns the
    // newest window, fetched descending and reversed back to ascending.
    const ascending = Boolean(after);
    const direction = ascending ? 'asc' : 'desc';
    const rows = await query
      .orderBy('created_at', direction)
      .orderBy(turnIndexExpr, direction)
      .orderBy('id', direction)
      .limit(limit + 1)
      .execute();

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    if (!ascending) page.reverse();

    const items = page.map((r) => this.mapMessageRow(r));
    if (!paged) return items;

    // Continuation edge: oldest row when paging back, newest when paging forward.
    const edge = ascending ? page[page.length - 1] : page[0];
    return {
      items,
      hasMore,
      nextCursor:
        hasMore && edge
          ? encodeMessageCursor({ createdAt: edge.created_at, turnIndex: edge.turn_index ?? -1, id: edge.id })
          : undefined,
    };
  }

  private mapMessageRow(r: MessageRow): Message {
    return {
      id: r.id,
      roomId: r.room_id,
      threadId: r.thread_id || undefined,
      senderType: r.sender_type as 'user',
      senderId: r.sender_id,
      senderDisplayName: r.sender_display_name,
      content: r.content,
      contentType: r.content_type as 'text',
      turnIndex: r.turn_index ?? undefined,
      deliveryTrace: r.delivery_trace_json ? JSON.parse(r.delivery_trace_json) : undefined,
      rawPayload: r.raw_payload_json ? JSON.parse(r.raw_payload_json) : undefined,
      createdAt: isoTimestamp(r.created_at),
    };
  }

  public async postMessage(params: {
    roomId: string;
    senderType: 'user' | 'agent_instance';
    senderId: string;
    senderDisplayName: string;
    content: string;
    contentType?: 'text' | 'markdown' | 'tool_call' | 'tool_result' | 'system';
    deliveryTrace?: ChatDeliveryTrace;
    turnIndex?: number;
    rawPayload?: Record<string, unknown>;
  }): Promise<Message> {
    const id = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const createdAt = nextMessageDate();

    await this.db.db
      .insertInto('messages')
      .values({
        id,
        room_id: params.roomId,
        sender_type: params.senderType,
        sender_id: params.senderId,
        sender_display_name: params.senderDisplayName,
        content: params.content,
        content_type: params.contentType || 'text',
        turn_index: params.turnIndex ?? null,
        delivery_trace_json: params.deliveryTrace ? JSON.stringify(params.deliveryTrace) : null,
        raw_payload_json: params.rawPayload ? JSON.stringify(params.rawPayload) : null,
        // Explicit millisecond-precision write; the column default only has
        // second granularity, which made same-second ordering arbitrary.
        created_at: sqliteTimestamp(createdAt),
      })
      .execute();

    const msg: Message = {
      id,
      roomId: params.roomId,
      senderType: params.senderType,
      senderId: params.senderId,
      senderDisplayName: params.senderDisplayName,
      content: params.content,
      contentType: params.contentType || 'text',
      turnIndex: params.turnIndex,
      deliveryTrace: params.deliveryTrace,
      rawPayload: params.rawPayload,
      createdAt: createdAt.toISOString(),
    };

    this.eventBus.emit('message:created', { message: msg });
    return msg;
  }
}

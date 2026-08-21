import { AgentDeckDatabase, createDatabase } from '@agentdeck/database';
import { EventBus } from './event-bus.js';
import { PromptComposer } from './prompt-composer.js';
import { TransactionalUpgradeEngine } from './upgrade-engine.js';
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
  HealthCheckLevel,
  HealthReport,
} from '@agentdeck/protocol';
import { ensureSecureDirectory } from '@agentdeck/security';
import path from 'node:path';
import os from 'node:os';

export interface ManagerOptions {
  db?: AgentDeckDatabase;
  eventBus?: EventBus;
}

export class AgentDeckManager {
  public readonly db: AgentDeckDatabase;
  public readonly eventBus: EventBus;
  public readonly promptComposer: PromptComposer;
  public readonly upgradeEngine: TransactionalUpgradeEngine;

  private adapterRegistry = new Map<string, AgentAdapter>();

  private constructor(db: AgentDeckDatabase, eventBus?: EventBus) {
    this.db = db;
    this.eventBus = eventBus || new EventBus();
    this.promptComposer = new PromptComposer();
    this.upgradeEngine = new TransactionalUpgradeEngine(this.eventBus);

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
      const isOutdated =
        detection.installed &&
        detection.version &&
        latest.latestVersion &&
        detection.version !== latest.latestVersion;

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
    await this.db.db
      .updateTable('personas')
      .set({
        name: updates.name,
        role: updates.role,
        language: updates.language,
        system_prompt: updates.systemPromptOverlay,
        avatar: updates.avatarEmoji,
        response_style: updates.responseStyle,
      })
      .where('id', '=', id)
      .execute();
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
  }): Promise<AgentInstance> {
    const id = `instance-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

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
      createdAt: now,
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
  // ROOMS & MESSAGING
  // ==========================================
  public async listRooms(): Promise<Room[]> {
    const rows = await this.db.db.selectFrom('rooms').selectAll().execute();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      mode: r.mode as 'mention',
      maxTurnsPerRun: r.turn_limit,
      maxRuntimeSec: r.runtime_limit_sec,
      maxCostUSD: r.cost_limit_usd || undefined,
      workspacePath: r.workspace_path || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public async createRoom(params: {
    name: string;
    description?: string;
    mode?: 'mention' | 'panel' | 'debate' | 'round_robin' | 'coordinator';
    workspacePath?: string;
    memberInstanceIds?: string[];
    memberUserIds?: string[];
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
        turn_limit: 10,
        runtime_limit_sec: 600,
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
      maxTurnsPerRun: 10,
      maxRuntimeSec: 600,
      workspacePath: params.workspacePath,
      createdAt: now,
      updatedAt: now,
    };
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
  }): Promise<void> {
    const id = `rm-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
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
  }

  public async removeMemberFromRoom(roomId: string, memberId: string): Promise<void> {
    await this.db.db
      .deleteFrom('room_members')
      .where('room_id', '=', roomId)
      .where('member_id', '=', memberId)
      .execute();
  }

  public async getRoomMessages(roomId: string, limit = 50): Promise<Message[]> {
    const rows = await this.db.db
      .selectFrom('messages')
      .selectAll()
      .where('room_id', '=', roomId)
      .orderBy('created_at', 'asc')
      .limit(limit)
      .execute();

    return rows.map((r) => ({
      id: r.id,
      roomId: r.room_id,
      threadId: r.thread_id || undefined,
      senderType: r.sender_type as 'user',
      senderId: r.sender_id,
      senderDisplayName: r.sender_display_name,
      content: r.content,
      contentType: r.content_type as 'text',
      turnIndex: r.turn_index || undefined,
      rawPayload: r.raw_payload_json ? JSON.parse(r.raw_payload_json) : undefined,
      createdAt: r.created_at,
    }));
  }

  public async postMessage(params: {
    roomId: string;
    senderType: 'user' | 'agent_instance';
    senderId: string;
    senderDisplayName: string;
    content: string;
    contentType?: 'text' | 'markdown' | 'tool_call' | 'tool_result' | 'system';
  }): Promise<Message> {
    const id = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

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
      createdAt: now,
    };

    this.eventBus.emit('message:created', { message: msg });
    return msg;
  }
}

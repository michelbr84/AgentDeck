import { z } from 'zod';

// ==========================================
// 1. DOMAIN IDENTIFIERS
// ==========================================
export const IdSchema = z.string().min(1);

// ==========================================
// 2. AGENT DEFINITIONS & CAPABILITIES
// ==========================================
export const AgentCapabilitiesSchema = z.object({
  // Lifecycle
  install: z.boolean().default(false),
  upgrade: z.boolean().default(false),
  healthCheck: z.boolean().default(true),
  backupConfig: z.boolean().default(false),

  // Runtime
  chat: z.boolean().default(true),
  streaming: z.boolean().default(false),
  interactiveTerminal: z.boolean().default(false),
  jsonRpcProtocol: z.boolean().default(false),

  // Overlays & Identity
  nativeSystemPrompt: z.boolean().default(false),
  promptOverlaySupported: z.boolean().default(true),
  languageInjectionSupported: z.boolean().default(true),
  modelSelection: z.boolean().default(false),
  multipleInstances: z.boolean().default(true),
  nativeIdentity: z.boolean().default(false),

  // Native Features
  tools: z.boolean().default(false),
  mcp: z.boolean().default(false),
  workspaceIsolation: z.boolean().default(false),
  nativeMemory: z.boolean().default(false),
  skills: z.boolean().default(false),
  channels: z.boolean().default(false),
});
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>;

export const RollbackCapabilitiesSchema = z.object({
  config: z.boolean().default(true),
  binary: z.boolean().default(false),
});
export type RollbackCapabilities = z.infer<typeof RollbackCapabilitiesSchema>;

export const AgentDefinitionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string(),
  version: z.string().default('1.0.0'),
  author: z.string().optional(),
  homepage: z.string().url().optional(),
  capabilities: AgentCapabilitiesSchema,
  rollbackCapabilities: RollbackCapabilitiesSchema.default({ config: true, binary: false }),
  supportedPlatforms: z.array(z.enum(['linux', 'darwin', 'win32'])).default(['linux']),
  supportedArchitectures: z.array(z.enum(['x64', 'arm64'])).default(['x64', 'arm64']),
});
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

// ==========================================
// 3. MULTI-DIMENSIONAL AGENT STATE & HEALTH
// ==========================================
export const AgentInstallationStateSchema = z.object({
  availability: z.enum(['available', 'unavailable']),
  installation: z.enum(['not_installed', 'installed']),
  configuration: z.enum(['unconfigured', 'configured']),
  authentication: z.enum(['unknown', 'unauthenticated', 'authenticated']),
  health: z.enum(['unknown', 'healthy', 'degraded', 'unhealthy']),
  version: z.enum(['unknown', 'current', 'outdated']),
  runtime: z.enum(['stopped', 'starting', 'running', 'stopping', 'error']),
});
export type AgentInstallationState = z.infer<typeof AgentInstallationStateSchema>;

export const HealthCheckLevelSchema = z.enum(['level1_static', 'level2_connectivity', 'level3_active']);
export type HealthCheckLevel = z.infer<typeof HealthCheckLevelSchema>;

export const DiagnosticItemSchema = z.object({
  name: z.string(),
  status: z.enum(['pass', 'warn', 'fail', 'skip']),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});
export type DiagnosticItem = z.infer<typeof DiagnosticItemSchema>;

export const HealthReportSchema = z.object({
  agentDefinitionId: IdSchema,
  checkedAt: z.string().datetime(),
  level: HealthCheckLevelSchema,
  overallStatus: z.enum(['healthy', 'degraded', 'unhealthy']),
  diagnostics: z.array(DiagnosticItemSchema),
});
export type HealthReport = z.infer<typeof HealthReportSchema>;

// ==========================================
// 4. AGENT INSTALLATION & INSTANCES
// ==========================================
export const InstallMethodSchema = z.enum(['npm', 'git', 'docker', 'native', 'pip', 'standalone', 'unknown']);
export type InstallMethod = z.infer<typeof InstallMethodSchema>;

export const AgentInstallationSchema = z.object({
  id: IdSchema,
  definitionId: IdSchema,
  binaryPath: z.string().nullable().optional(),
  installMethod: InstallMethodSchema,
  versionInstalled: z.string().nullable().optional(),
  versionLatest: z.string().nullable().optional(),
  state: AgentInstallationStateSchema,
  healthReport: HealthReportSchema.optional(),
  lastCheckedAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});
export type AgentInstallation = z.infer<typeof AgentInstallationSchema>;

export const AgentInstanceSchema = z.object({
  id: IdSchema,
  installationId: IdSchema,
  personaId: IdSchema,
  name: z.string().min(1),
  modelAlias: z.string().optional(),
  workspaceDir: z.string().optional(),
  permissionTier: z.enum(['safe', 'developer', 'autonomous', 'custom']).default('developer'),
  isActive: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AgentInstance = z.infer<typeof AgentInstanceSchema>;

// ==========================================
// 5. PERSONA OVERLAY
// ==========================================
export const PersonaSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  role: z.string().min(1),
  language: z.string().default('en-US'),
  systemPromptOverlay: z.string().default(''),
  avatarEmoji: z.string().default('🤖'),
  responseStyle: z.string().optional(),
  isTemplate: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Persona = z.infer<typeof PersonaSchema>;

// ==========================================
// 6. USERS: LOCAL PROFILE vs REMOTE USER
// ==========================================
export const UserTypeSchema = z.enum(['local_profile', 'remote_user']);
export type UserType = z.infer<typeof UserTypeSchema>;

export const UserProfileSchema = z.object({
  id: IdSchema,
  type: UserTypeSchema,
  displayName: z.string().min(1),
  avatar: z.string().default('👤'),
  email: z.string().email().optional(),
  publicKey: z.string().optional(),
  preferences: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

// ==========================================
// 7. ROOMS & CHAT MODES
// ==========================================
export const RoomModeSchema = z.enum(['mention', 'panel', 'debate', 'round_robin', 'coordinator']);
export type RoomMode = z.infer<typeof RoomModeSchema>;

export const RoomSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().default(''),
  mode: RoomModeSchema.default('mention'),
  defaultAgentInstanceId: IdSchema.nullable().optional(),
  maxTurnsPerRun: z.number().int().positive().default(10),
  maxRuntimeSec: z.number().int().positive().default(600),
  maxCostUSD: z.number().positive().optional(),
  workspacePath: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Room = z.infer<typeof RoomSchema>;

export const MemberTypeSchema = z.enum(['agent_instance', 'user']);
export type MemberType = z.infer<typeof MemberTypeSchema>;

export const RoomMemberSchema = z.object({
  id: IdSchema,
  roomId: IdSchema,
  memberType: MemberTypeSchema,
  memberId: IdSchema,
  role: z.enum(['owner', 'admin', 'participant', 'observer']).default('participant'),
  joinedAt: z.string().datetime(),
});
export type RoomMember = z.infer<typeof RoomMemberSchema>;

// ==========================================
// 7.1 CHAT DELIVERY TRACE & ROUTING DIAGNOSTICS
// ==========================================
export const ChatDeliveryStateSchema = z.enum([
  'persisted',
  'routing',
  'running',
  'completed',
  'failed',
  'no_target',
]);
export type ChatDeliveryState = z.infer<typeof ChatDeliveryStateSchema>;

export const ChatDeliveryReasonCodeSchema = z.enum([
  'direct_mention',
  'all_mention',
  'single_agent_auto',
  'room_default_agent',
  'panel_broadcast',
  'debate_turn',
  'coordinator_delegate',
  'zero_agents',
  'multiple_agents_no_target',
  'target_agent_inactive',
  'target_agent_not_member',
  'execution_error',
]);
export type ChatDeliveryReasonCode = z.infer<typeof ChatDeliveryReasonCodeSchema>;

export const ChatDeliveryTraceSchema = z.object({
  state: ChatDeliveryStateSchema,
  reasonCode: ChatDeliveryReasonCodeSchema,
  feedbackMessage: z.string(),
  actionableHint: z.string().optional(),
  targetInstanceIds: z.array(z.string()).default([]),
  targetInstanceNames: z.array(z.string()).default([]),
  roomMode: RoomModeSchema,
  timestamp: z.string().datetime(),
});
export type ChatDeliveryTrace = z.infer<typeof ChatDeliveryTraceSchema>;

// ==========================================
// 8. MESSAGES & ORCHESTRATION RUNS
// ==========================================
export const MessageContentTypeSchema = z.enum(['text', 'markdown', 'tool_call', 'tool_result', 'artifact', 'system']);
export type MessageContentType = z.infer<typeof MessageContentTypeSchema>;

export const MessageSchema = z.object({
  id: IdSchema,
  roomId: IdSchema,
  threadId: IdSchema.optional(),
  senderType: MemberTypeSchema,
  senderId: IdSchema,
  senderDisplayName: z.string(),
  content: z.string(),
  contentType: MessageContentTypeSchema.default('text'),
  turnIndex: z.number().int().nonnegative().optional(),
  deliveryTrace: ChatDeliveryTraceSchema.optional(),
  rawPayload: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime(),
});
export type Message = z.infer<typeof MessageSchema>;

// ==========================================
// 9. USAGE & METRICS (ESTIMATED / REPORTED)
// ==========================================
export const MetricSourceSchema = z.enum(['reported', 'estimated', 'unknown']);
export type MetricSource = z.infer<typeof MetricSourceSchema>;

export const UsageMetricSchema = z.object({
  value: z.number().nonnegative().optional(),
  source: MetricSourceSchema,
});
export type UsageMetric = z.infer<typeof UsageMetricSchema>;

export const RunUsageSchema = z.object({
  inputTokens: UsageMetricSchema,
  outputTokens: UsageMetricSchema,
  totalTokens: UsageMetricSchema,
  costUSD: UsageMetricSchema,
});
export type RunUsage = z.infer<typeof RunUsageSchema>;

// ==========================================
// 10. PROMPT COMPOSITION & PROVENANCE
// ==========================================
export const PromptLayerSchema = z.object({
  id: z.string(),
  order: z.number().int(),
  layerName: z.string(),
  source: z.string(),
  content: z.string(),
  tokenCount: UsageMetricSchema.optional(),
  redacted: z.boolean().default(false),
});
export type PromptLayer = z.infer<typeof PromptLayerSchema>;

export const PromptCompositionTreeSchema = z.object({
  instanceId: IdSchema,
  roomId: IdSchema.optional(),
  createdAt: z.string().datetime(),
  totalEstimatedTokens: UsageMetricSchema,
  layers: z.array(PromptLayerSchema),
  finalRawPrompt: z.string(),
});
export type PromptCompositionTree = z.infer<typeof PromptCompositionTreeSchema>;

// ==========================================
// 11. TYPED EVENT PROTOCOL & ENVELOPE
// ==========================================
export const EventEnvelopeSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  version: z.literal(1).default(1),
  timestamp: z.string().datetime(),
  correlationId: z.string().optional(),
  causationId: z.string().optional(),
  sessionId: IdSchema.optional(),
  runId: IdSchema.optional(),
  roomId: IdSchema.optional(),
  instanceId: IdSchema.optional(),
  payload: z.unknown(),
});
export type EventEnvelope<T = unknown> = Omit<z.infer<typeof EventEnvelopeSchema>, 'payload'> & {
  payload: T;
};

// ==========================================
// 12. NORMALIZED TRANSPORT & TURN EXECUTION
// ==========================================
export const AgentTransportKindSchema = z.enum([
  'cli-argv',
  'cli-stdin',
  'cli-json',
  'json-rpc',
  'http',
  'mock',
]);
export type AgentTransportKind = z.infer<typeof AgentTransportKindSchema>;

export const AgentMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  name: z.string().optional(),
  toolCalls: z.array(z.record(z.unknown())).optional(),
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export const AgentTurnRequestSchema = z.object({
  runId: IdSchema,
  sessionId: IdSchema,
  instanceId: IdSchema,
  roomId: IdSchema.optional(),
  messages: z.array(AgentMessageSchema),
  promptTree: PromptCompositionTreeSchema,
  workspaceDir: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  model: z.string().optional(),
  transport: AgentTransportKindSchema.optional(),
});
export type AgentTurnRequest = z.infer<typeof AgentTurnRequestSchema>;

export const AgentTurnResultSchema = z.object({
  content: z.string(),
  rawStdout: z.string().optional(),
  rawStderr: z.string().optional(),
  exitCode: z.number().int(),
  transport: AgentTransportKindSchema,
  tokensUsed: z.object({
    input: UsageMetricSchema,
    output: UsageMetricSchema,
    total: UsageMetricSchema,
  }),
  costUSD: UsageMetricSchema,
  diagnostics: z.array(z.string()).optional(),
  error: z.string().optional(),
});
export type AgentTurnResult = z.infer<typeof AgentTurnResultSchema>;

export type AgentStreamEvent =
  | { type: 'chunk'; text: string }
  | { type: 'tool_call'; toolName: string; args: unknown }
  | { type: 'tool_result'; toolName: string; result: unknown }
  | { type: 'diagnostic'; message: string };


// ==========================================
// 14. LLM ROUTING (provider + model + credential reference)
// ==========================================

/**
 * Providers AgentDeck knows how to configure across agents.
 *
 * `garraia-gateway` is the local GarraIA gateway speaking both the
 * OpenAI-compatible and Anthropic-compatible wires — it is how agents that
 * cannot express a fallback natively still get one.
 */
export const ProviderIdSchema = z.enum([
  'openrouter',
  'ollama',
  'openai',
  'anthropic',
  'garraia-gateway',
  'custom',
]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

/**
 * One resolved provider+model pair.
 *
 * `credentialRef` is a *reference* ("file:openrouter"), never the secret. The
 * name deliberately avoids `apiKey*`: `redactSecrets` blanks any key matching
 * that shape, which would erase this field on its way to the UI.
 */
export const ProviderBindingSchema = z.object({
  providerId: ProviderIdSchema,
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
  credentialRef: z.string().optional(),
});
export type ProviderBinding = z.infer<typeof ProviderBindingSchema>;

/** The deck-wide default: one primary, one optional backup. */
export const LlmRoutingSchema = z.object({
  primary: ProviderBindingSchema,
  backup: ProviderBindingSchema.optional(),
  updatedAt: z.string().datetime(),
});
export type LlmRouting = z.infer<typeof LlmRoutingSchema>;

/**
 * Per-instance escape hatch. Absent for almost every instance — applying one
 * routing to every agent is the default, and overriding is opt-in.
 */
export const AgentLlmOverrideSchema = z.object({
  instanceId: IdSchema,
  routing: LlmRoutingSchema,
});
export type AgentLlmOverride = z.infer<typeof AgentLlmOverrideSchema>;

/**
 * How an agent expresses a backup model, surfaced to the UI so it can tell the
 * truth instead of implying every agent failed over.
 */
export const BackupStrategySchema = z.enum(['native', 'via-gateway', 'none']);
export type BackupStrategy = z.infer<typeof BackupStrategySchema>;

/** How a credential reaches the agent. */
export const KeyDeliverySchema = z.enum([
  'native-config',
  'env-in-config',
  'key-helper-command',
  'gateway-proxy',
  'keychain',
]);
export type KeyDelivery = z.infer<typeof KeyDeliverySchema>;

/** Per-agent LLM capability, computed at request time — not stored. */
export const LlmConfigCapabilitySchema = z.object({
  configurable: z.boolean(),
  supportsBackup: z.boolean(),
  backupStrategy: BackupStrategySchema,
  keyDelivery: KeyDeliverySchema,
  configFiles: z.array(z.string()).default([]),
});
export type LlmConfigCapability = z.infer<typeof LlmConfigCapabilitySchema>;

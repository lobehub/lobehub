/**
 * API Key Scopes
 *
 * A scope describes what a signed API key is allowed to do. The effective
 * permission of a request is always the intersection of the issuer's own
 * permissions (RBAC / workspace role) and the key's scopes — scopes can only
 * narrow, never widen.
 *
 * Storage semantics on `api_keys.scopes`:
 * - `NULL`  → full access (every key issued before scopes existed)
 * - `['*']` → full access, explicitly chosen at creation time
 * - list    → restricted key; each entry must be a member of `API_KEY_SCOPES`
 *
 * Scopes are immutable after creation (same as GitHub tokens): re-issue the
 * key to change its powers.
 */

export const API_KEY_FULL_ACCESS_SCOPE = '*';

/**
 * The selectable scope catalog. `model:invoke` is its own tier because it is
 * the one that burns money (chat/completions, image, video, asr).
 *
 * Deliberately absent (a restricted key can never obtain them):
 * - `api_key:*` — keys must not mint keys (self-provisioning)
 * - `rbac:*`, member/role management — privilege escalation surface
 * - billing administration (spend / subscription / top-up / credits)
 */
export const API_KEY_SCOPES = [
  API_KEY_FULL_ACCESS_SCOPE,
  'agent:read',
  'agent:write',
  'chat:read',
  'chat:write',
  'model:invoke',
  'model:read',
  'model:write',
  'file:read',
  'file:write',
  'knowledge:read',
  'knowledge:write',
  'mcp:read',
  'mcp:write',
  'usage:read',
  'workspace:read',
  'workspace:write',
  'user:read',
  'user:write',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

const API_KEY_SCOPE_SET: ReadonlySet<string> = new Set(API_KEY_SCOPES);

export const isValidApiKeyScope = (scope: string): scope is ApiKeyScope =>
  API_KEY_SCOPE_SET.has(scope);

/**
 * `NULL` (legacy key) and `['*']` both mean full access.
 */
export const isFullAccessApiKey = (scopes?: string[] | null): boolean =>
  !scopes || scopes.includes(API_KEY_FULL_ACCESS_SCOPE);

/**
 * Does this scope list satisfy `required`? `x:write` implies `x:read` so a
 * write-capable key never has to double-select the read box.
 */
export const hasApiKeyScope = (
  scopes: string[] | null | undefined,
  required: ApiKeyScope,
): boolean => {
  if (isFullAccessApiKey(scopes)) return true;
  if (scopes!.includes(required)) return true;

  if (required.endsWith(':read')) {
    const writeTwin = required.replace(/:read$/, ':write');
    return scopes!.includes(writeTwin);
  }

  return false;
};

// ---------------------------------------------------------------------------
// OpenAPI (Hono) projection: RBAC permission action → required scope
// ---------------------------------------------------------------------------

/**
 * RBAC resource (the part before `:` in a permission action) → scope domain.
 * `null` means the resource is never reachable with a restricted key.
 */
const PERMISSION_RESOURCE_TO_SCOPE_DOMAIN: Record<string, string | null> = {
  agent: 'agent',
  agent_label: 'agent',
  ai_model: 'model',
  ai_provider: 'model',
  api_key: null,
  document: 'knowledge',
  file: 'file',
  knowledge_base: 'knowledge',
  message: 'chat',
  rbac: null,
  session: 'chat',
  session_group: 'chat',
  topic: 'chat',
  topic_comment: 'chat',
  translation: 'chat',
  user: 'user',
  workspace: 'workspace',
  workspace_audit: 'workspace',
  workspace_member: 'workspace',
  workspace_role: null,
};

const READ_ACTIONS = new Set(['read']);

/**
 * Map an RBAC permission action to the API key scope required to use it.
 * Accepts both the bare action form (`agent:create`) and the scope-suffixed
 * permission code form (`agent:create:owner`).
 *
 * Returns:
 * - an `ApiKeyScope` — restricted keys holding it may proceed
 * - `null` — the action is off-limits to restricted keys (fail closed)
 */
export const requiredApiKeyScopeForPermission = (permission: string): ApiKeyScope | null => {
  const [resource, action] = permission.split(':');
  if (!resource || !action) return null;

  // the single money-burning action gets its own tier
  if (resource === 'ai_model' && action === 'invoke') return 'model:invoke';

  const domain = PERMISSION_RESOURCE_TO_SCOPE_DOMAIN[resource];
  if (!domain) return null;

  const suffix = READ_ACTIONS.has(action) ? 'read' : 'write';
  const scope = `${domain}:${suffix}`;

  return isValidApiKeyScope(scope) ? scope : null;
};

// ---------------------------------------------------------------------------
// tRPC lambda projection: router namespace → required scope
// ---------------------------------------------------------------------------

/**
 * Per-namespace rule for the tRPC lambda surface (also covers the tools
 * router, which shares `authedProcedure`).
 *
 * - `'open'`     → no scope required (bootstrap / public info)
 * - `'blocked'`  → restricted keys can never call it (full-access keys can)
 * - `{ read, write }` → scope for queries / mutations; `null` blocks that half
 * - `{ any }`    → same scope for queries and mutations
 */
export type TrpcNamespaceScopeRule =
  | 'open'
  | 'blocked'
  | { any: ApiKeyScope }
  | { read: ApiKeyScope | null; write: ApiKeyScope | null };

const rw = (read: ApiKeyScope | null, write: ApiKeyScope | null): TrpcNamespaceScopeRule => ({
  read,
  write,
});

/**
 * Every namespace mounted on the lambda (and tools) router MUST appear here —
 * the guard denies unknown namespaces, and a consistency test in
 * `apps/server` fails when a newly added router is left uncategorized.
 */
export const TRPC_NAMESPACE_API_KEY_RULES: Record<string, TrpcNamespaceScopeRule> = {
  accountDeletion: 'blocked',
  acceptance: 'blocked',
  agent: rw('agent:read', 'agent:write'),
  // bot channel wiring carries channel credentials
  agentBotProvider: 'blocked',
  agentDocument: rw('knowledge:read', 'knowledge:write'),
  agentEval: 'blocked',
  agentEvalExternal: 'blocked',
  agentLabel: rw('agent:read', 'agent:write'),
  agentNotify: rw('agent:read', 'agent:write'),
  agentQuota: rw('agent:read', null),
  agentSignal: rw('agent:read', 'agent:write'),
  agentSkills: rw('agent:read', 'agent:write'),
  aiAgent: rw('agent:read', 'agent:write'),
  aiChat: { any: 'model:invoke' },
  aiModel: rw('model:read', 'model:write'),
  aiProvider: rw('model:read', 'model:write'),
  // keys must not mint or manage keys
  apiKey: 'blocked',
  asr: { any: 'model:invoke' },
  // decrypts stored bot/messenger credentials and calls external channel APIs
  botMessage: 'blocked',
  brief: rw('chat:read', 'chat:write'),
  changelog: 'open',
  chunk: rw('knowledge:read', 'knowledge:write'),
  comfyui: rw('model:read', 'model:write'),
  // third-party integrations hold external credentials
  composio: 'blocked',
  config: 'open',
  connector: 'blocked',
  device: 'blocked',
  document: rw('knowledge:read', 'knowledge:write'),
  expertise: rw('agent:read', 'agent:write'),
  // whole-account backup dump (settings incl. market tokens, providers, agents)
  exporter: 'blocked',
  file: rw('file:read', 'file:write'),
  followUpAction: rw('chat:read', 'chat:write'),
  generation: { any: 'model:invoke' },
  generationBatch: { any: 'model:invoke' },
  generationTopic: { any: 'model:invoke' },
  group: rw('agent:read', 'agent:write'),
  healthcheck: 'open',
  home: rw('chat:read', 'chat:write'),
  image: { any: 'model:invoke' },
  // whole-account backup import can overwrite credential-bearing settings,
  // provider/model config and agents
  importer: 'blocked',
  klavis: 'blocked',
  knowledge: rw('knowledge:read', 'knowledge:write'),
  knowledgeBase: rw('knowledge:read', 'knowledge:write'),
  llmGenerationTracing: 'blocked',
  market: rw('agent:read', 'agent:write'),
  // tool execution inside a chat run
  mcp: { any: 'model:invoke' },
  message: rw('chat:read', 'chat:write'),
  // IM channel management carries channel credentials
  messenger: 'blocked',
  notebook: rw('knowledge:read', 'knowledge:write'),
  notification: rw('user:read', 'user:write'),
  oauthApp: 'blocked',
  oauthDeviceFlow: 'blocked',
  pageShare: rw('chat:read', 'chat:write'),
  plugin: rw('agent:read', 'agent:write'),
  project: rw('agent:read', 'agent:write'),
  pushToken: 'blocked',
  ragEval: 'blocked',
  recent: rw('chat:read', null),
  referral: 'blocked',
  resourcePermission: 'blocked',
  // Member-to-member ownership handover: accepting/declining is an interactive
  // human decision, not something a restricted key should automate.
  resourceTransferRequest: 'blocked',
  search: rw('chat:read', null),
  session: rw('chat:read', 'chat:write'),
  sessionGroup: rw('chat:read', 'chat:write'),
  share: rw('chat:read', 'chat:write'),
  spend: 'blocked',
  storageOverage: 'blocked',
  subscription: 'blocked',
  task: rw('agent:read', 'agent:write'),
  taskTemplate: rw('agent:read', 'agent:write'),
  thread: rw('chat:read', 'chat:write'),
  topUp: 'blocked',
  topic: rw('chat:read', 'chat:write'),
  topicComment: rw('chat:read', 'chat:write'),
  upload: rw('file:read', 'file:write'),
  usage: rw('usage:read', null),
  user: rw('user:read', 'user:write'),
  userMemories: rw('user:read', 'user:write'),
  userMemory: rw('user:read', 'user:write'),
  verify: 'blocked',
  video: { any: 'model:invoke' },
  waitlist: 'blocked',
  webBrowsing: { any: 'model:invoke' },
  work: rw('agent:read', 'agent:write'),
  workspace: rw('workspace:read', 'workspace:write'),
  workspaceAuditLog: rw('workspace:read', null),
  workspaceCredits: 'blocked',
  workspaceCreds: 'blocked',
  workspaceData: 'blocked',
  workspaceMember: rw('workspace:read', null),
  workspaceUsage: 'blocked',
  workspaceUserSettings: rw('workspace:read', 'workspace:write'),
};

/**
 * Procedure-level extra scope requirements, keyed by the full
 * `namespace.procedure` path. Applied ON TOP of the namespace rule — the key
 * must satisfy both. Use this when a procedure has a side effect its namespace
 * scope does not capture, e.g. a knowledge-write mutation that internally
 * invokes a model.
 */
/**
 * Boundary note: embedding calls (chunk semantic search / memory search /
 * re-embed) are deliberately NOT gated by `model:invoke`. They are
 * retrieval/indexing infrastructure owned by their domain scope, their
 * per-call cost is marginal, and file-upload pipelines trigger the same
 * embedding work outside this guard anyway. Whether embeddings deserve their
 * own scope (e.g. `model:embed`) is still an open product decision.
 */
const AGENT_RUN_SCOPES: ApiKeyScope[] = ['chat:write', 'model:invoke'];

export const TRPC_PROCEDURE_EXTRA_SCOPES: Record<string, ApiKeyScope[]> = {
  // agent-run execution paths schedule model runs and write chat/topic state,
  // so `agent:write` alone must not start them
  'aiAgent.execAgent': AGENT_RUN_SCOPES,
  'aiAgent.execAgents': AGENT_RUN_SCOPES,
  'aiAgent.execGroupAgent': AGENT_RUN_SCOPES,
  'aiAgent.execSubAgentTask': AGENT_RUN_SCOPES,
  'aiAgent.scheduleAgentRun': AGENT_RUN_SCOPES,
  'aiAgent.startExecution': AGENT_RUN_SCOPES,
  // thread/message state writes without starting a run
  'aiAgent.createClientGroupAgentTaskThread': ['chat:write'],
  'aiAgent.createClientTaskThread': ['chat:write'],
  'aiAgent.interruptTask': ['chat:write'],
  'aiAgent.stopPendingApproval': ['chat:write'],
  'aiAgent.updateClientTaskThreadStatus': ['chat:write'],
  // intervention responses write messages and resume model execution
  'aiAgent.processHumanIntervention': AGENT_RUN_SCOPES,
  'aiAgent.submitHeteroIntervention': AGENT_RUN_SCOPES,
  // lists the caller's whole knowledge-base/file inventory, not agent config
  'agent.getKnowledgeBasesAndFiles': ['file:read', 'knowledge:read'],
  // notify's user/continue paths call `aiAgentService.execAgent` — another run entry
  'agentNotify.notify': AGENT_RUN_SCOPES,
  // signal triggers enqueue analyze-intent workflows whose judges call
  // `generateObject` (and may dispatch self-iteration runs)
  'agentSignal.emitSourceEvent': ['model:invoke'],
  'agentSignal.triggerSourceEvent': ['model:invoke'],
  // persists tool results into the topic's message history
  'aiChat.archiveToolResult': ['chat:write'],
  // creates user/assistant messages and topics alongside the model call
  'aiChat.sendMessageInServer': ['chat:write'],
  // connectivity test sends a real (1-token) chat request to the provider
  'aiProvider.checkProviderConnectivity': ['model:invoke'],
  // runs a ComfyUI image-generation workflow, not a config write
  'comfyui.createImage': ['model:invoke'],
  // extracts follow-up actions via `AiGenerationService.generateObject`
  'followUpAction.extract': ['model:invoke'],
  // asset cleanup/organization is file management, not model invocation —
  // a model-only key must not delete or reorganize generated assets
  'generation.deleteGeneration': ['file:write'],
  'generationBatch.deleteGenerationBatch': ['file:write'],
  'generationTopic.deleteTopic': ['file:write'],
  // sharing/visibility control is asset management, not generation
  'generationTopic.setTopicVisibility': ['file:write'],
  'generationTopic.updateTopic': ['file:write'],
  // fetches caller-supplied image data and uploads a cover file
  'generationTopic.updateTopicCover': ['file:write'],
  // Market tool-execution surface (mounted on the tools router): external
  // tool calls burn quota / cause side effects; file export writes files
  'market.callCloudMcpEndpoint': ['model:invoke'],
  'market.connectCallTool': ['model:invoke'],
  'market.exportAndUploadFile': ['file:write'],
  // executes a server-side MCP tool call with caller-supplied endpoint/args —
  // a model-only key must not trigger arbitrary tool side effects
  'mcp.callTool': ['agent:write'],
  // prefills the convert-to-skill form via an LLM call
  // (`SystemAgentService.generateSkillMeta` → `modelRuntime.generateObject`)
  'agentDocument.generateSkillMeta': ['model:invoke'],
  // home sidebar procedures read/reorganize the agent inventory, not chat data
  'home.getSidebarAgentList': ['agent:read'],
  'home.searchAgents': ['agent:read'],
  'home.updateAgentSessionGroupId': ['agent:write'],
  // task orchestration starts `execAgent` runs (run/runReadySubtasks) or calls
  // `generateObject` judges (runReview) — same boundary as `aiAgent.*`
  'task.run': AGENT_RUN_SCOPES,
  'task.runReadySubtasks': AGENT_RUN_SCOPES,
  'task.runReview': ['model:invoke'],
  // deletes the whole settings row, including stored provider credentials —
  // same bar as the `updateSettings` keyVaults guard
  'user.resetSettings': ['model:write'],
  // onboarding understanding triggers enqueue generation workflows
  // (persona / task-recommendation `generateObject` steps run async via QStash)
  'user.retryOnboardingUnderstandingSource': ['model:invoke'],
  'user.reviseOnboardingUnderstanding': ['model:invoke'],
  'user.startOnboardingUnderstanding': ['model:invoke'],
  // schedules the full memory-extraction workflow (embeddings + per-layer
  // `generateObject`), unlike the accepted search/re-embed embedding tradeoff
  'userMemory.requestMemoryFromChatTopic': ['model:invoke'],
  // persists crawled pages as `documents` rows — a knowledge write
  'webBrowsing.upsertCrawledDocument': ['knowledge:write'],
};

/**
 * Nested sub-surfaces denied to restricted keys regardless of the parent
 * namespace rule. The namespace table only sees the first path segment, so
 * sensitive subrouters mounted inside an otherwise-scoped namespace must be
 * blocked here by path prefix.
 */
export const TRPC_BLOCKED_PATH_PREFIXES: string[] = [
  // returns an unrestricted user JWT that passes `oidcAuth` as non-API-key
  // auth and would bypass the scope guard entirely
  'aiAgent.refreshGatewayToken',
  // sandbox execution mints a full LOBEHUB_JWT for `lh` commands
  // (`preprocessLhCommand`), which would bypass the key's scopes entirely
  'market.callCodeInterpreterTool',
  'market.execInSandbox',
  // marketplace credential management: list/decrypt/create/delete/share/inject
  // of external credentials — same class as the blocked connector/composio surfaces
  'market.creds.',
  // marketplace OIDC auth flows carry tokens
  'market.oidc.',
];

export type TrpcScopeDecision = { scopes: ApiKeyScope[] } | { open: true } | { blocked: true };

/**
 * Decide what a restricted API key needs to call `path` (`namespace.proc`).
 * Unknown namespaces are blocked — fail closed, so a newly added router is
 * never silently exposed to restricted keys.
 */
export const requiredApiKeyScopeForTrpc = (
  path: string,
  type: 'query' | 'mutation' | 'subscription',
): TrpcScopeDecision => {
  if (TRPC_BLOCKED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix)))
    return { blocked: true };

  const namespace = path.split('.')[0];
  const rule = TRPC_NAMESPACE_API_KEY_RULES[namespace];

  if (!rule || rule === 'blocked') return { blocked: true };

  const base =
    rule === 'open' ? null : 'any' in rule ? rule.any : type === 'query' ? rule.read : rule.write;

  // a namespace half with no scope grants nothing to restricted keys
  if (rule !== 'open' && !base) return { blocked: true };

  const scopes = [
    ...new Set([base, ...(TRPC_PROCEDURE_EXTRA_SCOPES[path] ?? [])].filter(Boolean)),
  ] as ApiKeyScope[];

  return scopes.length > 0 ? { scopes } : { open: true };
};

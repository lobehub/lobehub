/**
 * Central SWR key registry
 *
 * Single source of truth for SWR cache keys, organized by business domain and
 * named with one convention: the first array element is `'<domain>:<resource>'`
 * (lowerCamel resource), followed by parameters.
 *
 * Benefits:
 * - Consistent, discoverable naming (`swrKeys.topic.list(...)`).
 * - The `domain:` prefix lets the tiered cache provider route persistence by
 *   domain (see `localStorageProvider.ts`) and lets callers refresh a whole
 *   domain at once via `matchDomain('topic:')`.
 *
 * Each factory also exposes `.root` (the namespace string) for `mutate`
 * matchers that compare `key[0]`.
 *
 * Document / page / notebook / agent-document keys are defined in
 * `@/services/document/swrKeys` (already a factory, widely imported) and
 * re-exported here so the whole set is reachable from one place.
 */
import {
  agentDocumentSWRKeys,
  documentSWRKeys,
  notebookSWRKeys,
} from '@/services/document/swrKeys';

type KeyFactory<A extends unknown[]> = ((...args: A) => readonly unknown[]) & { root: string };

/** Define a key factory carrying its namespace root (for `mutate` matchers). */
const def = <A extends unknown[]>(
  root: string,
  build: (...args: A) => readonly unknown[],
): KeyFactory<A> => Object.assign(build, { root });

interface LocalFilePreviewKeyParams {
  accept?: 'image';
  allowExternalFile?: boolean;
  deviceId?: string;
  filePath: string;
  workingDirectory: string;
}

// ---- message ------------------------------------------------------------
/**
 * Message cache schema version. Baked into the message list key so a bump
 * invalidates every persisted message cache entry (e.g. after a message shape
 * change), without touching other domains. Increment when the cached
 * `UIChatMessage[]` shape changes incompatibly.
 */
export const MESSAGE_CACHE_VERSION = 1;

export const messageKeys = {
  /**
   * Messages for a conversation, keyed by request context + cache version.
   * Shared by the conversation store and the chat store so a single fetch
   * serves both.
   */
  list: def('message:list', (context: unknown) => ['message:list', context, MESSAGE_CACHE_VERSION]),
};

// ---- topic --------------------------------------------------------------
export const topicKeys = {
  agentView: def('topic:agentView', (containerKey: string, opts: Record<string, unknown>) => [
    'topic:agentView',
    containerKey,
    opts,
  ]),
  list: def('topic:list', (containerKey: string, opts: Record<string, unknown>) => [
    'topic:list',
    containerKey,
    opts,
  ]),
  search: def('topic:search', (keywords: string, agentId?: string, groupId?: string) => [
    'topic:search',
    keywords,
    agentId,
    groupId,
  ]),
};

// ---- fleet (Observation Mode board) -------------------------------------
export const fleetKeys = {
  /** Account-wide set of actively-running topics powering the Observation board. */
  runningTopics: def('fleet:runningTopics', () => ['fleet:runningTopics']),
};

// ---- agent --------------------------------------------------------------
export const agentKeys = {
  /** Sidebar agent list. */
  list: def('agent:list', (isLogin: boolean) => ['agent:list', isLogin]),
};

// ---- agent builder (opening-suggestion chips) ---------------------------
// Kept off `CACHE_TIERS` on purpose — these are ephemeral LLM-generated chips.
// `contextSummary` is intentionally NOT part of the key so config autosaves for
// the same target don't refetch; `nonce` bumps on manual refresh.
export const agentBuilderKeys = {
  suggestions: def(
    'agentBuilder:suggestions',
    (mode: string, builderAgentId: string, targetId: string | undefined, nonce: number) => [
      'agentBuilder:suggestions',
      mode,
      builderAgentId,
      targetId,
      nonce,
    ],
  ),
};

// ---- group --------------------------------------------------------------
export const groupKeys = {
  detail: def('group:detail', (groupId: string) => ['group:detail', groupId]),
  list: def('group:list', (isLogin: boolean) => ['group:list', isLogin]),
  /** Agent picker for the "add member" modal. */
  queryAgents: def('group:queryAgents', () => ['group:queryAgents']),
  /** Agent picker for the "create group" modal. */
  queryAgentsForCreate: def('group:queryAgentsForCreate', () => ['group:queryAgentsForCreate']),
};

// ---- session ------------------------------------------------------------
export const sessionKeys = {
  createSession: def('session:createSession', (groupId: string | undefined) => [
    'session:createSession',
    groupId,
  ]),
  list: def('session:list', (isLogin: boolean | undefined) => ['session:list', isLogin]),
  search: def('session:search', (keyword?: string) => ['session:search', keyword]),
};

// ---- thread -------------------------------------------------------------
export const threadKeys = {
  list: def('thread:list', (topicId: string) => ['thread:list', topicId]),
};

// ---- recent -------------------------------------------------------------
export const recentKeys = {
  /** Home "all recents" drawer list, keyed by open state. */
  allDrawer: def('recent:allDrawer', (open: boolean) => ['recent:allDrawer', open]),
  /** Home recents list, keyed by login + limit. */
  list: def('recent:list', (isLogin: boolean, limit: number) => ['recent:list', isLogin, limit]),
};

// ---- task ---------------------------------------------------------------
export const taskKeys = {
  detail: def('task:detail', (taskId: string) => ['task:detail', taskId]),
  groupList: def(
    'task:groupList',
    (agentKey: string | undefined, visibility: 'all' | 'private' | 'workspace' = 'all') => [
      'task:groupList',
      agentKey,
      visibility,
    ],
  ),
  list: def(
    'task:list',
    (agentKey: string | undefined, visibility: 'all' | 'private' | 'workspace' = 'all') => [
      'task:list',
      agentKey,
      visibility,
    ],
  ),
};

// ---- brief --------------------------------------------------------------
export const briefKeys = {
  list: def('brief:list', (isLogin: boolean) => ['brief:list', isLogin]),
};

// ---- agent config / available / search ----------------------------------
// (agentKeys.list defined above)
export const agentConfigKeys = {
  available: def('agent:available', () => ['agent:available']),
  config: def('agent:config', (agentId: string) => ['agent:config', agentId]),
  search: def('agent:search', (keyword?: string) => ['agent:search', keyword]),
};

// ---- aiModel ------------------------------------------------------------
export const aiModelKeys = {
  disabledModelsPage: def('aiModel:disabledModelsPage', (providerId: string, offset: number) => [
    'aiModel:disabledModelsPage',
    providerId,
    offset,
  ]),
  list: def('aiModel:list', (provider: string | undefined) => ['aiModel:list', provider]),
};

// ---- image generation ---------------------------------------------------
export const imageKeys = {
  generationBatches: def('image:generationBatches', (topicId: string) => [
    'image:generationBatches',
    topicId,
  ]),
  generationStatus: def('image:generationStatus', (generationId: string, asyncTaskId?: string) => [
    'image:generationStatus',
    generationId,
    asyncTaskId,
  ]),
  generationTopics: def('image:generationTopics', () => ['image:generationTopics']),
};

// ---- video generation ---------------------------------------------------
export const videoKeys = {
  generationBatches: def('video:generationBatches', (topicId: string) => [
    'video:generationBatches',
    topicId,
  ]),
  generationStatus: def('video:generationStatus', (generationId: string, asyncTaskId?: string) => [
    'video:generationStatus',
    generationId,
    asyncTaskId,
  ]),
  generationTopics: def('video:generationTopics', () => ['video:generationTopics']),
};

// ---- serverConfig -------------------------------------------------------
export const serverConfigKeys = {
  get: 'serverConfig:get' as const,
};

// ---- discover (marketplace) ---------------------------------------------
// NOTE: discover/eval/ragEval/knowledgeBase/device/userMemory/agentKnowledge/
// agentBot/file/chatTool prefixes are deliberately kept OUT of `CACHE_TIERS`
// (see localStorageProvider.ts) so this key-convergence introduces no new
// persistence — they stay memory-only exactly as before.
export const discoverKeys = {
  assistantCategories: def('discover:assistantCategories', (locale: string, params: unknown) => [
    'discover:assistantCategories',
    locale,
    params,
  ]),
  assistantDetail: def('discover:assistantDetail', (locale: string, params: unknown) => [
    'discover:assistantDetail',
    locale,
    params,
  ]),
  assistantIdentifiers: def('discover:assistantIdentifiers', (source?: string) => [
    'discover:assistantIdentifiers',
    source,
  ]),
  assistantList: def('discover:assistantList', (locale: string, params: unknown) => [
    'discover:assistantList',
    locale,
    params,
  ]),
  favoriteAgents: def('discover:favoriteAgents', (userId: number, params?: unknown) => [
    'discover:favoriteAgents',
    userId,
    params,
  ]),
  favoritePlugins: def('discover:favoritePlugins', (userId: number, params?: unknown) => [
    'discover:favoritePlugins',
    userId,
    params,
  ]),
  followCounts: def('discover:followCounts', (userId: number) => ['discover:followCounts', userId]),
  followStatus: def('discover:followStatus', (userId: number) => ['discover:followStatus', userId]),
  followers: def('discover:followers', (userId: number, params?: unknown) => [
    'discover:followers',
    userId,
    params,
  ]),
  following: def('discover:following', (userId: number, params?: unknown) => [
    'discover:following',
    userId,
    params,
  ]),
  groupAgentCategories: def('discover:groupAgentCategories', (locale: string, params: unknown) => [
    'discover:groupAgentCategories',
    locale,
    params,
  ]),
  groupAgentDetail: def(
    'discover:groupAgentDetail',
    (locale: string, identifier: string, version?: string) => [
      'discover:groupAgentDetail',
      locale,
      identifier,
      version,
    ],
  ),
  groupAgentIdentifiers: def('discover:groupAgentIdentifiers', () => [
    'discover:groupAgentIdentifiers',
  ]),
  groupAgentList: def('discover:groupAgentList', (locale: string, params: unknown) => [
    'discover:groupAgentList',
    locale,
    params,
  ]),
  mcpCategories: def('discover:mcpCategories', (locale: string, params: unknown) => [
    'discover:mcpCategories',
    locale,
    params,
  ]),
  mcpDetail: def('discover:mcpDetail', (locale: string, identifier: string, version?: string) => [
    'discover:mcpDetail',
    locale,
    identifier,
    version,
  ]),
  mcpList: def('discover:mcpList', (locale: string, params: unknown) => [
    'discover:mcpList',
    locale,
    params,
  ]),
  modelCategories: def('discover:modelCategories', (params: unknown) => [
    'discover:modelCategories',
    params,
  ]),
  modelDetail: def('discover:modelDetail', (locale: string, identifier: string) => [
    'discover:modelDetail',
    locale,
    identifier,
  ]),
  modelIdentifiers: def('discover:modelIdentifiers', () => ['discover:modelIdentifiers']),
  modelList: def('discover:modelList', (locale: string, params: unknown) => [
    'discover:modelList',
    locale,
    params,
  ]),
  pluginCategories: def('discover:pluginCategories', (locale: string, params: unknown) => [
    'discover:pluginCategories',
    locale,
    params,
  ]),
  pluginDetail: def(
    'discover:pluginDetail',
    (locale: string, identifier: string, withManifest?: boolean) => [
      'discover:pluginDetail',
      locale,
      identifier,
      withManifest,
    ],
  ),
  pluginIdentifiers: def('discover:pluginIdentifiers', () => ['discover:pluginIdentifiers']),
  pluginList: def('discover:pluginList', (locale: string, params: unknown) => [
    'discover:pluginList',
    locale,
    params,
  ]),
  providerDetail: def('discover:providerDetail', (locale: string, identifier: string) => [
    'discover:providerDetail',
    locale,
    identifier,
  ]),
  providerIdentifiers: def('discover:providerIdentifiers', () => ['discover:providerIdentifiers']),
  providerList: def('discover:providerList', (locale: string, params: unknown) => [
    'discover:providerList',
    locale,
    params,
  ]),
  skillCategories: def('discover:skillCategories', (locale: string, params: unknown) => [
    'discover:skillCategories',
    locale,
    params,
  ]),
  skillDetail: def(
    'discover:skillDetail',
    (locale: string, identifier: string, version?: string) => [
      'discover:skillDetail',
      locale,
      identifier,
      version,
    ],
  ),
  skillList: def('discover:skillList', (locale: string, params: unknown) => [
    'discover:skillList',
    locale,
    params,
  ]),
  userProfile: def('discover:userProfile', (locale: string, username: string) => [
    'discover:userProfile',
    locale,
    username,
  ]),
  // -- marketplace detail "related agents" lists (UI) --
  mcpAgents: def('discover:mcpAgents', (identifier: string, page: number) => [
    'discover:mcpAgents',
    identifier,
    page,
  ]),
  skillAgents: def('discover:skillAgents', (identifier: string, page: number) => [
    'discover:skillAgents',
    identifier,
    page,
  ]),
  skillStoreMarketSkills: def(
    'discover:skillStoreMarketSkills',
    (locale: string, keywords: string, page: number) => [
      'discover:skillStoreMarketSkills',
      locale,
      keywords,
      page,
    ],
  ),
};

// ---- agent eval ---------------------------------------------------------
export const evalKeys = {
  benchmarkDetail: def('eval:benchmarkDetail', (id: string) => ['eval:benchmarkDetail', id]),
  benchmarks: def('eval:benchmarks', () => ['eval:benchmarks']),
  datasetDetail: def('eval:datasetDetail', (id: string) => ['eval:datasetDetail', id]),
  datasetRuns: def('eval:datasetRuns', (datasetId: string) => ['eval:datasetRuns', datasetId]),
  datasets: def('eval:datasets', (benchmarkId: string) => ['eval:datasets', benchmarkId]),
  runDetail: def('eval:runDetail', (id: string) => ['eval:runDetail', id]),
  runResults: def('eval:runResults', (id: string) => ['eval:runResults', id]),
  runs: def('eval:runs', (benchmarkId?: string) => ['eval:runs', benchmarkId]),
  testCases: def('eval:testCases', (datasetId: string, limit?: number, offset?: number) => [
    'eval:testCases',
    datasetId,
    limit,
    offset,
  ]),
};

// ---- RAG eval -----------------------------------------------------------
export const ragEvalKeys = {
  datasetList: def('ragEval:datasetList', (knowledgeBaseId?: string) => [
    'ragEval:datasetList',
    knowledgeBaseId,
  ]),
  datasetRecords: def('ragEval:datasetRecords', (datasetId: string) => [
    'ragEval:datasetRecords',
    datasetId,
  ]),
  evaluationList: def('ragEval:evaluationList', (knowledgeBaseId?: string) => [
    'ragEval:evaluationList',
    knowledgeBaseId,
  ]),
};

// ---- knowledge base -----------------------------------------------------
export const knowledgeBaseKeys = {
  item: def('knowledgeBase:item', (id: string) => ['knowledgeBase:item', id]),
  list: def(
    'knowledgeBase:list',
    (workspaceId?: string | null, visibility?: 'private' | 'public') => {
      const base = workspaceId ? ['knowledgeBase:list', workspaceId] : ['knowledgeBase:list'];
      return visibility ? [...base, visibility] : base;
    },
  ),
};

// ---- device -------------------------------------------------------------
export const deviceKeys = {
  gitAheadBehind: def('device:gitAheadBehind', (deviceId: string, path: string) => [
    'device:gitAheadBehind',
    deviceId,
    path,
  ]),
  gitBranch: def('device:gitBranch', (deviceId: string, path: string) => [
    'device:gitBranch',
    deviceId,
    path,
  ]),
  gitBranches: def('device:gitBranches', (deviceId: string, path: string) => [
    'device:gitBranches',
    deviceId,
    path,
  ]),
  gitLinkedPR: def('device:gitLinkedPR', (deviceId: string, path: string, branch: string) => [
    'device:gitLinkedPR',
    deviceId,
    path,
    branch,
  ]),
  gitRemoteBranches: def('device:gitRemoteBranches', (deviceId: string, dirPath: string) => [
    'device:gitRemoteBranches',
    deviceId,
    dirPath,
  ]),
  gitReviewPatches: def(
    'device:gitReviewPatches',
    (deviceId: string, dirPath: string, mode: string, baseRef: string) => [
      'device:gitReviewPatches',
      deviceId,
      dirPath,
      mode,
      baseRef,
    ],
  ),
  gitWorkingTreeStatus: def('device:gitWorkingTreeStatus', (deviceId: string, path: string) => [
    'device:gitWorkingTreeStatus',
    deviceId,
    path,
  ]),
  gitWorktrees: def('device:gitWorktrees', (deviceId: string, path: string) => [
    'device:gitWorktrees',
    deviceId,
    path,
  ]),
  listDevices: def('device:listDevices', () => ['device:listDevices']),
  repoType: def('device:repoType', (path: string) => ['device:repoType', path]),
};

// ---- user memory --------------------------------------------------------
export const userMemoryKeys = {
  activities: def('userMemory:activities', (params: unknown) => ['userMemory:activities', params]),
  analysisTask: def('userMemory:analysisTask', (taskId?: string) => [
    'userMemory:analysisTask',
    taskId,
  ]),
  contexts: def('userMemory:contexts', (params: unknown) => ['userMemory:contexts', params]),
  experiences: def('userMemory:experiences', (params: unknown) => [
    'userMemory:experiences',
    params,
  ]),
  /** Injection identities (distinct from the paginated `identityList`). */
  identities: def('userMemory:identities', () => ['userMemory:identities']),
  /** Paginated identity list for the memory home views. */
  identityList: def('userMemory:identityList', (params: unknown) => [
    'userMemory:identityList',
    params,
  ]),
  memoryDetail: def('userMemory:memoryDetail', (layer: string, id: string) => [
    'userMemory:memoryDetail',
    layer,
    id,
  ]),
  persona: def('userMemory:persona', () => ['userMemory:persona']),
  preferences: def('userMemory:preferences', (params: unknown) => [
    'userMemory:preferences',
    params,
  ]),
  retrieve: def('userMemory:retrieve', (cacheKey: string | undefined) => [
    'userMemory:retrieve',
    cacheKey,
  ]),
  tags: def('userMemory:tags', () => ['userMemory:tags']),
  topicMemories: def('userMemory:topicMemories', (topicId: string) => [
    'userMemory:topicMemories',
    topicId,
  ]),
};

// ---- tool (skills / plugins / builtin / mcp / composio stores) -------------
export const toolKeys = {
  agentSkillDetail: def('tool:agentSkillDetail', (id: string) => ['tool:agentSkillDetail', id]),
  agentSkills: def('tool:agentSkills', () => ['tool:agentSkills']),
  composioAppTools: def('tool:composioAppTools', (appSlug: string) => [
    'tool:composioAppTools',
    appSlug,
  ]),
  composioConnections: def('tool:composioConnections', () => ['tool:composioConnections']),
  installedPlugins: def('tool:installedPlugins', () => ['tool:installedPlugins']),
  lobehubSkillConnections: def('tool:lobehubSkillConnections', () => [
    'tool:lobehubSkillConnections',
  ]),
  lobehubSkillTools: def('tool:lobehubSkillTools', (provider: string) => [
    'tool:lobehubSkillTools',
    provider,
  ]),
  mcpPluginList: def('tool:mcpPluginList', (locale: string, params: unknown) => [
    'tool:mcpPluginList',
    locale,
    params,
  ]),
  uninstalledBuiltins: def('tool:uninstalledBuiltins', (workspaceId: string | null | undefined) => [
    'tool:uninstalledBuiltins',
    workspaceId,
  ]),
};

// ---- global -------------------------------------------------------------
export const globalKeys = {
  latestVersion: def('global:latestVersion', () => ['global:latestVersion']),
  serverVersion: def('global:serverVersion', () => ['global:serverVersion']),
  systemStatus: def('global:systemStatus', () => ['global:systemStatus']),
};

// ---- agent knowledge (kept off the `agent:` idb tier on purpose) --------
export const agentKnowledgeKeys = {
  list: def(
    'agentKnowledge:list',
    (agentId: string | undefined, visibility?: 'private' | 'public') => {
      const base = ['agentKnowledge:list', agentId] as const;
      return visibility ? [...base, visibility] : base;
    },
  ),
};

// ---- agent bot ----------------------------------------------------------
export const agentBotKeys = {
  platformDefinitions: def('agentBot:platformDefinitions', () => ['agentBot:platformDefinitions']),
  providers: def('agentBot:providers', (agentId: string) => ['agentBot:providers', agentId]),
};

// ---- file ---------------------------------------------------------------
export const fileKeys = {
  knowledgeItems: def('file:knowledgeItems', (params: unknown) => ['file:knowledgeItems', params]),
  ttsFile: def('file:ttsFile', (messageId: string) => ['file:ttsFile', messageId]),
};

// ---- chat tools ---------------------------------------------------------
export const chatToolKeys = {
  interpreterFile: def('chat:interpreterFile', (id: string) => ['chat:interpreterFile', id]),
};

// =========================================================================
// UI-layer keys (features / routes / components). Prefixes below stay
// memory-only unless explicitly listed in `CACHE_TIERS`. Names avoid colliding
// with cached prefixes — e.g. share/topicInfo is `share:` not `topic:`, portal
// header is `portal:` not `document:`.
// =========================================================================

// ---- stats (settings/stats + user header counts) ------------------------
export const statsKeys = {
  agentUsageStat: def(
    'stats:agentUsageStat',
    (agentId: string, startAt: string, endAt: string, granularity: string) => [
      'stats:agentUsageStat',
      agentId,
      startAt,
      endAt,
      granularity,
    ],
  ),
  agents: def('stats:agents', () => ['stats:agents']),
  countAgents: def('stats:countAgents', () => ['stats:countAgents']),
  countMessages: def('stats:countMessages', () => ['stats:countMessages']),
  countSessions: def('stats:countSessions', () => ['stats:countSessions']),
  countTopics: def('stats:countTopics', () => ['stats:countTopics']),
  heatmaps: def('stats:heatmaps', (type: string) => ['stats:heatmaps', type]),
  maxTaskDuration: def('stats:maxTaskDuration', () => ['stats:maxTaskDuration']),
  messages: def('stats:messages', () => ['stats:messages']),
  rankAgents: def('stats:rankAgents', () => ['stats:rankAgents']),
  rankModels: def('stats:rankModels', () => ['stats:rankModels']),
  rankTopics: def('stats:rankTopics', () => ['stats:rankTopics']),
  sessions: def('stats:sessions', () => ['stats:sessions']),
  topics: def('stats:topics', () => ['stats:topics']),
  usageLogs: def('stats:usageLogs', () => ['stats:usageLogs']),
  usageStat: def('stats:usageStat', () => ['stats:usageStat']),
  welcome: def('stats:welcome', () => ['stats:welcome']),
};

// ---- messenger / platform integration -----------------------------------
export const messengerKeys = {
  agentsForBinding: def('messenger:agentsForBinding', (workspaceId: string | null | undefined) => [
    'messenger:agentsForBinding',
    workspaceId ?? null,
  ]),
  availablePlatforms: def('messenger:availablePlatforms', () => ['messenger:availablePlatforms']),
  bindingScopes: def('messenger:bindingScopes', () => ['messenger:bindingScopes']),
  listMyInstallations: def('messenger:listMyInstallations', () => [
    'messenger:listMyInstallations',
  ]),
  listMyLinks: def('messenger:listMyLinks', () => ['messenger:listMyLinks']),
  myLink: def('messenger:myLink', (platform: string, tokenScopeKey: string | undefined) => [
    'messenger:myLink',
    platform,
    tokenScopeKey,
  ]),
  peek: def('messenger:peek', (randomId: string) => ['messenger:peek', randomId]),
};

// ---- verify (deliverable judging) ---------------------------------------
export const verifyKeys = {
  criteria: def('verify:criteria', () => ['verify:criteria']),
  instruction: def('verify:instruction', (documentId: string) => [
    'verify:instruction',
    documentId,
  ]),
  reportBundle: def('verify:reportBundle', (verifyRunId: string) => [
    'verify:reportBundle',
    verifyRunId,
  ]),
  reportSummaries: def('verify:reportSummaries', () => ['verify:reportSummaries']),
  results: def('verify:results', (operationId: string) => ['verify:results', operationId]),
  rubric: def('verify:rubric', (rubricId: string) => ['verify:rubric', rubricId]),
  rubricCriteria: def('verify:rubricCriteria', (rubricId: string) => [
    'verify:rubricCriteria',
    rubricId,
  ]),
  rubrics: def('verify:rubrics', () => ['verify:rubrics']),
  state: def('verify:state', (operationId: string) => ['verify:state', operationId]),
  tracing: def('verify:tracing', (tracingId: string) => ['verify:tracing', tracingId]),
};

// ---- inbox / notifications ----------------------------------------------
export const inboxKeys = {
  notifications: def(
    'inbox:notifications',
    (cursor: string | undefined, unreadOnly: boolean | undefined) => [
      'inbox:notifications',
      cursor,
      unreadOnly,
    ],
  ),
  unreadCount: def('inbox:unreadCount', () => ['inbox:unreadCount']),
};

// ---- share (shared topic / page) ----------------------------------------
export const shareKeys = {
  pageDocument: def('share:pageDocument', (documentId: string) => [
    'share:pageDocument',
    documentId,
  ]),
  topic: def('share:topic', (id: string) => ['share:topic', id]),
  topicInfo: def('share:topicInfo', (topicId: string) => ['share:topicInfo', topicId]),
};

// ---- fork source (community detail) -------------------------------------
export const forkKeys = {
  groupSource: def('fork:groupSource', (identifier: string) => ['fork:groupSource', identifier]),
  source: def('fork:source', (identifier: string) => ['fork:source', identifier]),
};

// ---- portal -------------------------------------------------------------
export const portalKeys = {
  documentHeader: def('portal:documentHeader', (documentId: string) => [
    'portal:documentHeader',
    documentId,
  ]),
};

// ---- local file ---------------------------------------------------------
export const localFileKeys = {
  gitWorkingTreeFiles: def(
    'localFile:gitWorkingTreeFiles',
    (deviceId: string | undefined, dirPath: string) => [
      'localFile:gitWorkingTreeFiles',
      deviceId ?? 'local',
      dirPath,
    ],
  ),
  preview: def(
    'localFile:preview',
    ({
      accept,
      allowExternalFile,
      deviceId,
      filePath,
      workingDirectory,
    }: LocalFilePreviewKeyParams) => [
      'localFile:preview',
      deviceId ?? 'local',
      filePath,
      workingDirectory,
      accept ?? 'any',
      allowExternalFile ? 'external' : 'workspace',
    ],
  ),
  projectIndex: def('localFile:projectIndex', (deviceId: string | undefined, dirPath: string) => [
    'localFile:projectIndex',
    deviceId ?? 'local',
    dirPath,
  ]),
};

// ---- favorite status (marketplace detail headers) -----------------------
export const favoriteKeys = {
  status: def('favorite:status', (targetType: string, identifier: string) => [
    'favorite:status',
    targetType,
    identifier,
  ]),
};

// ---- changelog ----------------------------------------------------------
export const changelogKeys = {
  modalIndex: def('changelog:modalIndex', () => ['changelog:modalIndex']),
  post: def('changelog:post', (id: string, locale: string) => ['changelog:post', id, locale]),
};

// ---- agent onboarding ---------------------------------------------------
export const onboardingKeys = {
  agentBootstrap: def('onboarding:agentBootstrap', () => ['onboarding:agentBootstrap']),
  agentHistoryTopics: def('onboarding:agentHistoryTopics', (agentId: string) => [
    'onboarding:agentHistoryTopics',
    agentId,
  ]),
};

// ---- agent home / profile / signal (kept off the `agent:` idb tier) -----
export const agentHomeKeys = {
  topics: def('agentHome:topics', (agentId: string) => ['agentHome:topics', agentId]),
};
export const agentProfileKeys = {
  detail: def('agentProfile:detail', (agentId: string) => ['agentProfile:detail', agentId]),
};
export const agentSignalKeys = {
  receipts: def('agentSignal:receipts', (agentId: string, topicId: string) => [
    'agentSignal:receipts',
    agentId,
    topicId,
  ]),
};

// ---- misc UI singletons -------------------------------------------------
export const ollamaKeys = {
  downloadModel: def('ollama:downloadModel', (model: string) => ['ollama:downloadModel', model]),
};
export const authKeys = {
  oidcInteraction: def('auth:oidcInteraction', (uid: string) => ['auth:oidcInteraction', uid]),
};
export const cronKeys = {
  topicsWithJobInfo: def('cron:topicsWithJobInfo', (agentId: string | undefined) => [
    'cron:topicsWithJobInfo',
    agentId,
  ]),
};
/** Imperative "save / create topic" action (useActionSWR), shared across call sites. */
export const topicActionKeys = {
  openNewOrSave: def('topicAction:openNewOrSave', () => ['topicAction:openNewOrSave']),
};

// ---- misc remaining domains ---------------------------------------------
export const homeKeys = {
  dailyBrief: def('home:dailyBrief', (userId: string) => ['home:dailyBrief', userId]),
};

/**
 * Daily task-template recommendation cache schema version. Bump this when the
 * persisted recommendation row shape changes incompatibly so desktop clients
 * stop reading stale localStorage SWR entries.
 */
export const TASK_TEMPLATE_RECOMMENDATION_CACHE_VERSION = 2;
const TASK_TEMPLATE_DAILY_RECOMMEND_ROOT = `taskTemplate:listDailyRecommend:v${TASK_TEMPLATE_RECOMMENDATION_CACHE_VERSION}`;

export const taskTemplateKeys = {
  listDailyRecommend: def(
    TASK_TEMPLATE_DAILY_RECOMMEND_ROOT,
    (refreshSeed: unknown, recommendationCount: number, locale: string) => [
      TASK_TEMPLATE_DAILY_RECOMMEND_ROOT,
      refreshSeed,
      recommendationCount,
      locale,
    ],
  ),
};
export const resourceKeys = {
  list: def('resource:list', (params: unknown, workspaceId: string | null) => [
    'resource:list',
    params,
    workspaceId,
  ]),
  search: def('resource:search', (params: unknown) => ['resource:search', params]),
};
export const providerKeys = {
  clientConfig: def('provider:clientConfig', (id: string) => ['provider:clientConfig', id]),
};
export const recommendationsKeys = {
  heteroDetections: def('recommendations:heteroDetections', () => [
    'recommendations:heteroDetections',
  ]),
};
export const openInAppKeys = {
  detect: def('openInApp:detect', () => ['openInApp:detect']),
};
export const gatewayKeys = {
  reconnect: def('gateway:reconnect', (operationId: string) => ['gateway:reconnect', operationId]),
};
export const userKeys = {
  checkTrace: def('user:checkTrace', () => ['user:checkTrace']),
  initState: def('user:initState', () => ['user:initState']),
};
export const builtinAgentKeys = {
  init: def('builtinAgent:init', (slug: string) => ['builtinAgent:init', slug]),
};
export const imessageKeys = {
  bridgeStatus: def('imessage:bridgeStatus', () => ['imessage:bridgeStatus']),
};
export const sidebarKeys = {
  taskGroups: def('sidebar:taskGroups', (agentId: string) => ['sidebar:taskGroups', agentId]),
};
// Desktop/electron IPC fetches — roots keep their existing `electron:getXxx` value.
export const electronKeys = {
  appTrayVisible: def('electron:getAppTrayVisible', () => ['electron:getAppTrayVisible']),
  desktopHotkeys: def('electron:getDesktopHotkeys', () => ['electron:getDesktopHotkeys']),
  gatewayDeviceInfo: def('electron:getGatewayDeviceInfo', () => ['electron:getGatewayDeviceInfo']),
  proxySettings: def('electron:getProxySettings', () => ['electron:getProxySettings']),
  remoteServerConfig: def('electron:getRemoteServerConfig', () => [
    'electron:getRemoteServerConfig',
  ]),
};

/**
 * Build a `mutate` matcher that selects every key in a `domain:` namespace.
 *
 * @example mutate(matchDomain('topic:')) // refresh all topic caches
 */
export const matchDomain =
  (prefix: string) =>
  (key: unknown): boolean =>
    Array.isArray(key) && typeof key[0] === 'string' && key[0].startsWith(prefix);

/**
 * Aggregate registry — one entry point for every domain's keys.
 */
export const swrKeys = {
  agent: { ...agentKeys, ...agentConfigKeys },
  agentBot: agentBotKeys,
  agentBuilder: agentBuilderKeys,
  agentDocument: agentDocumentSWRKeys,
  agentHome: agentHomeKeys,
  agentKnowledge: agentKnowledgeKeys,
  agentProfile: agentProfileKeys,
  agentSignal: agentSignalKeys,
  aiModel: aiModelKeys,
  auth: authKeys,
  brief: briefKeys,
  builtinAgent: builtinAgentKeys,
  changelog: changelogKeys,
  chatTool: chatToolKeys,
  cron: cronKeys,
  device: deviceKeys,
  discover: discoverKeys,
  document: documentSWRKeys,
  electron: electronKeys,
  eval: evalKeys,
  favorite: favoriteKeys,
  file: fileKeys,
  fleet: fleetKeys,
  fork: forkKeys,
  gateway: gatewayKeys,
  global: globalKeys,
  group: groupKeys,
  home: homeKeys,
  image: imageKeys,
  imessage: imessageKeys,
  inbox: inboxKeys,
  knowledgeBase: knowledgeBaseKeys,
  localFile: localFileKeys,
  message: messageKeys,
  messenger: messengerKeys,
  notebook: notebookSWRKeys,
  ollama: ollamaKeys,
  onboarding: onboardingKeys,
  openInApp: openInAppKeys,
  portal: portalKeys,
  provider: providerKeys,
  ragEval: ragEvalKeys,
  recent: recentKeys,
  recommendations: recommendationsKeys,
  resource: resourceKeys,
  serverConfig: serverConfigKeys,
  session: sessionKeys,
  share: shareKeys,
  sidebar: sidebarKeys,
  stats: statsKeys,
  task: taskKeys,
  taskTemplate: taskTemplateKeys,
  thread: threadKeys,
  tool: toolKeys,
  topic: topicKeys,
  topicAction: topicActionKeys,
  user: userKeys,
  userMemory: userMemoryKeys,
  verify: verifyKeys,
  video: videoKeys,
};

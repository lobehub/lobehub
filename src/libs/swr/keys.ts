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

// ---- agent --------------------------------------------------------------
export const agentKeys = {
  /** Sidebar agent list. */
  list: def('agent:list', (isLogin: boolean) => ['agent:list', isLogin]),
};

// ---- group --------------------------------------------------------------
export const groupKeys = {
  detail: def('group:detail', (groupId: string) => ['group:detail', groupId]),
  list: def('group:list', (isLogin: boolean) => ['group:list', isLogin]),
};

// ---- session ------------------------------------------------------------
export const sessionKeys = {
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
  groupList: def('task:groupList', (agentKey: string | undefined) => ['task:groupList', agentKey]),
  list: def('task:list', (agentKey: string | undefined) => ['task:list', agentKey]),
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
  modelIdentifiers: def('discover:modelIdentifiers', () => ['discover:modelIdentifiers']),
  pluginIdentifiers: def('discover:pluginIdentifiers', () => ['discover:pluginIdentifiers']),
  providerIdentifiers: def('discover:providerIdentifiers', () => ['discover:providerIdentifiers']),
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
  list: def('knowledgeBase:list', (workspaceId?: string | null) =>
    workspaceId ? ['knowledgeBase:list', workspaceId] : ['knowledgeBase:list'],
  ),
};

// ---- device -------------------------------------------------------------
export const deviceKeys = {
  gitAheadBehind: def('device:gitAheadBehind', (deviceId: string, path: string) => [
    'device:gitAheadBehind',
    deviceId,
    path,
  ]),
  gitInfo: def('device:gitInfo', (deviceId: string, path: string, isGithub: boolean) => [
    'device:gitInfo',
    deviceId,
    path,
    isGithub,
  ]),
  gitWorkingTreeStatus: def('device:gitWorkingTreeStatus', (deviceId: string, path: string) => [
    'device:gitWorkingTreeStatus',
    deviceId,
    path,
  ]),
  listDevices: def('device:listDevices', () => ['device:listDevices']),
};

// ---- user memory --------------------------------------------------------
export const userMemoryKeys = {
  identities: def('userMemory:identities', () => ['userMemory:identities']),
  persona: def('userMemory:persona', () => ['userMemory:persona']),
  tags: def('userMemory:tags', () => ['userMemory:tags']),
  topicMemories: def('userMemory:topicMemories', (topicId: string) => [
    'userMemory:topicMemories',
    topicId,
  ]),
};

// ---- agent knowledge (kept off the `agent:` idb tier on purpose) --------
export const agentKnowledgeKeys = {
  list: def('agentKnowledge:list', (agentId: string | undefined) => [
    'agentKnowledge:list',
    agentId,
  ]),
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
  agentDocument: agentDocumentSWRKeys,
  agentKnowledge: agentKnowledgeKeys,
  aiModel: aiModelKeys,
  brief: briefKeys,
  chatTool: chatToolKeys,
  device: deviceKeys,
  discover: discoverKeys,
  document: documentSWRKeys,
  eval: evalKeys,
  file: fileKeys,
  group: groupKeys,
  image: imageKeys,
  knowledgeBase: knowledgeBaseKeys,
  message: messageKeys,
  notebook: notebookSWRKeys,
  ragEval: ragEvalKeys,
  recent: recentKeys,
  serverConfig: serverConfigKeys,
  session: sessionKeys,
  task: taskKeys,
  thread: threadKeys,
  topic: topicKeys,
  userMemory: userMemoryKeys,
  video: videoKeys,
};

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
import { type ConversationContext } from '@lobechat/types';

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
  resourceScope?: 'workspace';
  /** Topic scope when the previewed file lives in the topic's cloud sandbox. */
  sandboxTopicId?: string;
  workingDirectory: string;
}

// ---- message ------------------------------------------------------------
export interface MessageListQueryContext {
  agentId?: string | null;
  groupId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
  topicShareId?: string;
}

export interface CanonicalMessageListContext {
  agentId: string | null;
  groupId: string | null;
  threadId: string | null;
  topicId: string | null;
  topicShareId?: string;
}

/**
 * Reduce every UI conversation variant to the fields understood by the
 * message-list server query. Keeping normalization beside the key definition
 * makes key equivalence a property of the registry rather than a caller
 * convention.
 */
export const normalizeMessageListQueryContext = (
  context: MessageListQueryContext,
): CanonicalMessageListContext => ({
  agentId: context.agentId ?? null,
  groupId: context.groupId ?? null,
  threadId: context.threadId ?? null,
  topicId: context.topicId ?? null,
  ...(context.topicShareId === undefined ? {} : { topicShareId: context.topicShareId }),
});

/** Previous persisted key schema, used only by the targeted v1 → v2 migration. */
export const LEGACY_MESSAGE_CACHE_VERSION = 1;

/**
 * Message cache key schema version. Version 2 canonicalizes query context, so
 * it requires a persisted-key migration even though `UIChatMessage[]` itself
 * did not change.
 */
export const MESSAGE_CACHE_VERSION = 2;

export const messageKeys = {
  /**
   * Messages for a conversation, keyed by request context + cache version.
   * Shared by the conversation store and the chat store so a single fetch
   * serves both.
   */
  list: def('message:list', (context: MessageListQueryContext) => [
    'message:list',
    normalizeMessageListQueryContext(context),
    MESSAGE_CACHE_VERSION,
  ]),
};

/**
 * SWR `mutate` matcher for `message:list` keys. The key shape is
 * `[message:list, ConversationContext, version]`, so this guards `key[0]` and
 * hands the resolved context to an optional predicate (omit it to match every
 * message list, any scope / thread / page-size / version variant). Shared by
 * every message-list invalidation site so the key-shape knowledge lives once.
 */
export const isMessageListKey = (
  key: unknown,
  predicate?: (context: ConversationContext) => boolean,
): boolean => {
  if (!Array.isArray(key) || key[0] !== messageKeys.list.root) return false;
  const context = key[1] as ConversationContext | undefined;
  return !!context && (predicate ? predicate(context) : true);
};

// ---- topic --------------------------------------------------------------
export const topicKeys = {
  agentView: def('topic:agentView', (containerKey: string, opts: Record<string, unknown>) => [
    'topic:agentView',
    containerKey,
    opts,
  ]),
  detail: def('topic:detail', (topicId: string) => ['topic:detail', topicId]),
  list: def('topic:list', (containerKey: string, opts: Record<string, unknown>) => [
    'topic:list',
    containerKey,
    opts,
  ]),
  scheduledRunWatch: def('topic:scheduledRunWatch', (topicId: string) => [
    'topic:scheduledRunWatch',
    topicId,
  ]),
  search: def('topic:search', (keywords: string, agentId?: string, groupId?: string) => [
    'topic:search',
    keywords,
    agentId,
    groupId,
  ]),
};

// ---- topic comment ------------------------------------------------------
export const topicCommentKeys = {
  detail: def('topicComment:detail', (commentId: string) => ['topicComment:detail', commentId]),
  replies: def(
    'topicComment:replies',
    (workspaceId: string | null, rootCommentId: string, cursor?: string) => [
      'topicComment:replies',
      workspaceId ?? '',
      rootCommentId,
      cursor ?? '',
    ],
  ),
  summary: def('topicComment:summary', (topicId: string) => ['topicComment:summary', topicId]),
  threads: def(
    'topicComment:threads',
    (workspaceId: string | null, topicId: string, messageId?: string, cursor?: string) => [
      'topicComment:threads',
      workspaceId ?? '',
      topicId,
      messageId ?? '',
      cursor ?? '',
    ],
  ),
  warmup: def('topicComment:warmup', (workspaceId: string, topicId: string) => [
    'topicComment:warmup',
    workspaceId,
    topicId,
  ]),
};

// ---- document comment ---------------------------------------------------
export const documentCommentKeys = {
  replies: def(
    'documentComment:replies',
    (workspaceId: string | null, rootCommentId: string, cursor?: string) => [
      'documentComment:replies',
      workspaceId ?? '',
      rootCommentId,
      cursor ?? '',
    ],
  ),
  summary: def('documentComment:summary', (documentId: string) => [
    'documentComment:summary',
    documentId,
  ]),
  threads: def(
    'documentComment:threads',
    (workspaceId: string | null, documentId: string, cursor?: string) => [
      'documentComment:threads',
      workspaceId ?? '',
      documentId,
      cursor ?? '',
    ],
  ),
};

export const isDocumentCommentKeyForEvent = (
  key: unknown,
  event: { documentId: string; rootCommentId?: string; workspaceId: string },
): boolean => {
  if (!Array.isArray(key)) return false;

  if (key[0] === documentCommentKeys.summary.root) return key[1] === event.documentId;
  if (key[1] !== event.workspaceId) return false;
  if (key[0] === documentCommentKeys.threads.root) return key[2] === event.documentId;
  if (key[0] === documentCommentKeys.replies.root) {
    return !event.rootCommentId || key[2] === event.rootCommentId;
  }
  return false;
};

// ---- agent --------------------------------------------------------------
export const agentKeys = {
  /** Sidebar agent list. */
  list: def('agent:list', (isLogin: boolean) => ['agent:list', isLogin]),
};

// ---- agent labels -------------------------------------------------------
export const agentLabelKeys = {
  /**
   * Agent label registry (workspace-shared, or personal). Keyed by workspace:
   * the registries are disjoint per scope, so a shared key would serve the
   * previous workspace's labels across a switch.
   */
  list: def('agentLabel:list', (isLogin: boolean, workspaceId: string | null | undefined) => [
    'agentLabel:list',
    isLogin,
    workspaceId ?? null,
  ]),
};

// ---- agent builder (opening-suggestion chips) ---------------------------
// Persisted to the localStorage tier (see `CACHE_TIERS.local`) so revisits skip
// the LLM generation instead of paying a skeleton + a generateJSON call every
// page load. `contextSummary` is intentionally NOT part of the key so config
// autosaves for the same target don't refetch; manual refresh revalidates the
// same key in place (see `useBuilderSuggestions`). `locale` IS part of the key:
// chips are generated in the UI language, so a persisted entry must not be
// served after a language switch.
export const agentBuilderKeys = {
  suggestions: def(
    'agentBuilder:suggestions',
    (mode: string, builderAgentId: string, targetId: string | undefined, locale?: string) => [
      'agentBuilder:suggestions',
      mode,
      builderAgentId,
      targetId,
      locale ?? null,
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
  /** Home "all recents" drawer list, keyed by open state and identity scope. */
  allDrawer: def('recent:allDrawer', (open: boolean, scope: string) => [
    'recent:allDrawer',
    open,
    scope,
  ]),
  /** Home recents list, keyed by login + limit + identity scope. */
  list: def('recent:list', (isLogin: boolean, limit: number, scope: string) => [
    'recent:list',
    isLogin,
    limit,
    scope,
  ]),
  /** Home chat-only list; filtering happens before the server-side limit. */
  topicList: def('recent:topicList', (limit: number, scope: string, view: 'mine' | 'team') => [
    'recent:topicList',
    limit,
    scope,
    view,
  ]),
};

// ---- task ---------------------------------------------------------------
/**
 * SWR `mutate` matcher for every cached `task:list` variant — any agent scope,
 * visibility chip, ordering, or automation filter. A task edit can move a row
 * across each of those boundaries at once (reassigning, sharing, touching its
 * `updatedAt`, attaching a schedule), so refresh invalidates by key root
 * instead of enumerating variants.
 */
export const isTaskListKey = (key: unknown): boolean =>
  Array.isArray(key) && key[0] === 'task:list';

export const isScheduledTaskListKey = (key: unknown): boolean =>
  Array.isArray(key) && key[0] === 'task:scheduledList';

/**
 * Goal Graph reads. Keyed by the `goals` row id (not the carrier task's
 * identifier) because that is what every `goal.*` procedure takes.
 */
export const goalKeys = {
  graph: def('goal:graph', (goalId: string) => ['goal:graph', goalId]),
};

export const taskKeys = {
  detail: def('task:detail', (taskId: string) => ['task:detail', taskId]),
  groupList: def(
    'task:groupList',
    (
      agentKey: string | undefined,
      visibility: 'all' | 'private' | 'workspace' = 'all',
      groupBy: 'assignee' | 'priority' | 'status' = 'status',
      excludeStatuses?: string,
      projectId?: string,
      automated?: boolean,
    ) => {
      const hasBoardFilter = groupBy !== 'status' || excludeStatuses !== undefined;
      const key = hasBoardFilter
        ? projectId
          ? ['task:groupList', agentKey, visibility, groupBy, excludeStatuses, projectId]
          : ['task:groupList', agentKey, visibility, groupBy, excludeStatuses]
        : projectId
          ? ['task:groupList', agentKey, visibility, projectId]
          : ['task:groupList', agentKey, visibility];

      return automated === undefined ? key : [...key, { automated }];
    },
  ),
  /**
   * The home rail's cross-agent goal roll-up. Scoped by cache scope like the
   * other home feeds — goals are workspace rows, so a list left over from the
   * previous workspace holds ids this one cannot open.
   */
  homeGoals: def('task:homeGoals', (scope: string) => ['task:homeGoals', scope]),
  list: def(
    'task:list',
    (
      agentKey: string | undefined,
      visibility: 'all' | 'private' | 'workspace' = 'all',
      // Part of the key, not a detail: Home orders by activity while the Tasks
      // page orders by creation, and they read the same store field.
      orderBy: 'createdAt' | 'updatedAt' = 'createdAt',
      projectId?: string,
      // Same reasoning as `orderBy`: Home's recent block excludes live
      // automation and finished statuses server-side while the Tasks page
      // fetches everything, and a shared entry would serve one surface the
      // other's filter. Folded into one trailing slot (appended only when a
      // filter is actually set) so unfiltered keys keep their shape.
      filters?: { automated?: boolean; statuses?: readonly string[] },
    ) => {
      const key = projectId
        ? ['task:list', agentKey, visibility, orderBy, projectId]
        : ['task:list', agentKey, visibility, orderBy];
      const automated = filters?.automated;
      // Order-insensitive: the same status set must hash to the same key.
      const statuses = filters?.statuses?.length
        ? [...filters.statuses].sort().join(',')
        : undefined;
      if (automated === undefined && statuses === undefined) return key;
      return [
        ...key,
        {
          ...(automated === undefined ? {} : { automated }),
          ...(statuses === undefined ? {} : { statuses }),
        },
      ];
    },
  ),
  /**
   * Home's automated-task roll-up: the tasks that fire on a schedule or a
   * heartbeat. Kept off `list` because it is a different result set entirely —
   * sharing the key would let one section's fetch overwrite the other's.
   */
  scheduledList: def(
    'task:scheduledList',
    (
      agentKey: string | undefined,
      visibility: 'all' | 'private' | 'workspace' = 'all',
      limit?: number,
      offset?: number,
    ) => [
      'task:scheduledList',
      agentKey,
      visibility,
      ...(limit === undefined && offset === undefined ? [] : [{ limit, offset }]),
    ],
  ),
  /**
   * AgentSidebar task panel. Lives in the `task:` domain (not a `sidebar:`
   * one) so the tiered cache provider persists it to IndexedDB and the second
   * open renders from cache instead of a skeleton.
   */
  sidebarGroups: def('task:sidebarGroups', (agentId: string) => ['task:sidebarGroups', agentId]),
};

// ---- work ---------------------------------------------------------------
export const workKeys = {
  conversation: def('work:conversation', (topicId: string, threadId?: string | null) => [
    'work:conversation',
    topicId,
    threadId ?? null,
  ]),
  versions: def('work:versions', (workId: string) => ['work:versions', workId]),
  // Cross-topic Work gallery on the resource page: keyed by owner scope + the
  // gallery filter key (type OR provider tab, e.g. `all` / `task` / `linear`) +
  // keyset cursor (one entry per infinite-scroll page) + the Resources
  // Private/Workspace visibility. The filter key (not the Work type) is the
  // discriminator so the per-provider linear/github tabs, which share the
  // `external` Work type, get distinct cache entries.
  workspace: def(
    'work:workspace',
    (
      workspaceId: string | null | undefined,
      filterKey: string,
      cursor?: string | null,
      visibility?: 'private' | 'public' | null,
    ) => ['work:workspace', workspaceId ?? null, filterKey, cursor ?? null, visibility ?? null],
  ),
};

// ---- brief --------------------------------------------------------------
export const briefKeys = {
  /**
   * Unresolved brief feed, keyed by login + identity scope. Briefs are per-user
   * AND per-workspace rows, so an entry fetched in one scope must never be
   * served in another — its ids are unreachable there.
   */
  list: def('brief:list', (isLogin: boolean, scope: string) => ['brief:list', isLogin, scope]),
  /**
   * Day-scoped news digest (`insight` + `result`, resolved included), keyed by
   * the viewer's local day (`YYYY-MM-DD`) on top of the identity scope.
   */
  news: def('brief:news', (isLogin: boolean, scope: string, day: string) => [
    'brief:news',
    isLogin,
    scope,
    day,
  ]),
};

// ---- home inbox ---------------------------------------------------------
export const homeInboxKeys = {
  /** Account-wide topics powering the home inbox (running + unread + needs-input). */
  topics: def('home:inboxTopics', (isLogin: boolean) => ['home:inboxTopics', isLogin]),
};

// ---- agent config / available / search ----------------------------------
// (agentKeys.list defined above)
export const agentConfigKeys = {
  available: def('agent:available', () => ['agent:available']),
  config: def('agent:config', (agentId: string) => ['agent:config', agentId]),
  search: def('agent:search', (keyword?: string) => ['agent:search', keyword]),
  serverDefaultHeterogeneousCapability: def('agent:serverDefaultHeterogeneousCapability', () => [
    'agent:serverDefaultHeterogeneousCapability',
  ]),
};

// ---- aiModel ------------------------------------------------------------
export const aiModelKeys = {
  disabledModelsPage: def('aiModel:disabledModelsPage', (providerId: string, offset: number) => [
    'aiModel:disabledModelsPage',
    providerId,
    offset,
  ]),
  list: def('aiModel:list', (provider: string | undefined) => ['aiModel:list', provider]),
  reasoningConfig: def('aiModel:reasoningConfig', (provider: string, model: string) => [
    'aiModel:reasoningConfig',
    provider,
    model,
  ]),
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
  skillComments: def('discover:skillComments', (identifier: string, params: unknown) => [
    'discover:skillComments',
    identifier,
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
  skillRatingDistribution: def('discover:skillRatingDistribution', (identifier: string) => [
    'discover:skillRatingDistribution',
    identifier,
  ]),
  skillRelated: def(
    'discover:skillRelated',
    (locale: string, category: string, identifier: string) => [
      'discover:skillRelated',
      locale,
      category,
      identifier,
    ],
  ),
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
  experimentDetail: def('eval:experimentDetail', (id: string) => ['eval:experimentDetail', id]),
  experiments: def('eval:experiments', () => ['eval:experiments']),
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
  gitLinkedPR: def(
    'device:gitLinkedPR',
    (deviceId: string, path: string, branch: string, pullRequestNumber?: number) => [
      'device:gitLinkedPR',
      deviceId,
      path,
      branch,
      ...(pullRequestNumber === undefined ? [] : [pullRequestNumber]),
    ],
  ),
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

// ---- api key (settings/apikey) -------------------------------------------
export const apiKeyKeys = {
  list: def('apiKey:list', () => ['apiKey:list']),
};

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
  pushWindow: def('messenger:pushWindow', (platform: string, tenantId?: string) => [
    'messenger:pushWindow',
    platform,
    tenantId ?? null,
  ]),
};

// ---- verify (deliverable judging) ---------------------------------------
export const expertiseKeys = {
  domain: def('expertise:domain', (domainId: string) => ['expertise:domain', domainId]),
  historyCount: def('expertise:historyCount', (agentId: string) => [
    'expertise:historyCount',
    agentId,
  ]),
  lesson: def('expertise:lesson', (lessonId: string) => ['expertise:lesson', lessonId]),
  overview: def('expertise:overview', (agentId: string) => ['expertise:overview', agentId]),
};

export const verifyKeys = {
  acceptanceBundle: def('verify:acceptanceBundle', (acceptanceId: string) => [
    'verify:acceptanceBundle',
    acceptanceId,
  ]),
  acceptanceBySubject: def(
    'verify:acceptanceBySubject',
    (subjectType: string, subjectId: string) => [
      'verify:acceptanceBySubject',
      subjectType,
      subjectId,
    ],
  ),
  /** Statuses for a known subject set. Ids are sorted+joined so the key is order-free. */
  acceptanceStatuses: def(
    'verify:acceptanceStatuses',
    (subjectType: string, subjectIds: string[]) => [
      'verify:acceptanceStatuses',
      subjectType,
      [...subjectIds].sort().join(','),
    ],
  ),
  /** Query inputs are part of the key so server-side list filtering never reuses stale rows. */
  acceptances: def('verify:acceptances', (limit?: number, q?: string, filter?: string) => [
    'verify:acceptances',
    String(limit ?? ''),
    q ?? '',
    filter ?? '',
  ]),
  criteria: def('verify:criteria', () => ['verify:criteria']),
  instruction: def('verify:instruction', (documentId: string) => [
    'verify:instruction',
    documentId,
  ]),
  reportBundle: def('verify:reportBundle', (verifyRunId: string) => [
    'verify:reportBundle',
    verifyRunId,
  ]),
  reportSummaries: def(
    'verify:reportSummaries',
    (workspaceId?: string | null, q?: string, cursor?: string) => [
      'verify:reportSummaries',
      workspaceId ?? '',
      q ?? '',
      cursor ?? '',
    ],
  ),
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

/** Match every parameterized Acceptance list key (filter / limit / search variants). */
export const isAcceptanceListKey = (key: unknown): boolean =>
  Array.isArray(key) && key[0] === verifyKeys.acceptances.root;

// ---- inbox / notifications ----------------------------------------------
export const inboxKeys = {
  navigationCounts: def('inbox:navigationCounts', (workspaceId: string | null) => [
    'inbox:navigationCounts',
    workspaceId,
  ]),
  notifications: def(
    'inbox:notifications',
    // Keyed by context: the server scopes the inbox to the active workspace
    // (null = personal), so cached pages must never be reused across contexts.
    (
      workspaceId: string | null,
      cursor: string | undefined,
      category: string | undefined,
      isRead: boolean | undefined,
    ) => ['inbox:notifications', workspaceId, cursor, category, isRead],
  ),
  unreadCount: def('inbox:unreadCount', (workspaceId: string | null) => [
    'inbox:unreadCount',
    workspaceId,
  ]),
};

// ---- share (shared topic / page) ----------------------------------------
export const shareKeys = {
  artifact: def('share:artifact', (id: string) => ['share:artifact', id]),
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
      resourceScope,
      sandboxTopicId,
      workingDirectory,
    }: LocalFilePreviewKeyParams) => [
      'localFile:preview',
      sandboxTopicId ? `sandbox:${sandboxTopicId}` : (deviceId ?? 'local'),
      filePath,
      workingDirectory,
      accept ?? 'any',
      allowExternalFile ? 'external' : 'workspace',
      resourceScope ?? 'single-file',
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
  analysisStatus: def('onboarding:analysisStatus', () => ['onboarding:analysisStatus']),
  profile: def('onboarding:profile', () => ['onboarding:profile']),
  suggestedTasks: def('onboarding:suggestedTasks', () => ['onboarding:suggestedTasks']),
  understandingSession: def('onboarding:understandingSession', (topicId: string) => [
    'onboarding:understandingSession',
    topicId,
  ]),
  understandingStart: def('onboarding:understandingStart', (topicId: string) => [
    'onboarding:understandingStart',
    topicId,
  ]),
  understandingTopic: def('onboarding:understandingTopic', () => ['onboarding:understandingTopic']),
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
  oauthAppById: def('auth:oauthAppById', (id: string) => ['auth:oauthAppById', id]),
  oauthAppList: def('auth:oauthAppList', () => ['auth:oauthAppList']),
  oidcClientMetadata: def('auth:oidcClientMetadata', (clientId: string) => [
    'auth:oidcClientMetadata',
    clientId,
  ]),
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
  // Every Resources cache entry is workspace-scoped: the same visibility means
  // different rows in each workspace, so leaving `workspaceId` out of the key
  // makes a workspace switch serve the previous workspace's rows from cache.
  recentFiles: def(
    'resource:recentFiles',
    (workspaceId: string | null, visibility?: 'private' | 'public') => [
      'resource:recentFiles',
      workspaceId,
      visibility ?? null,
    ],
  ),
  recentPages: def(
    'resource:recentPages',
    (workspaceId: string | null, visibility?: 'private' | 'public') => [
      'resource:recentPages',
      workspaceId,
      visibility ?? null,
    ],
  ),
  search: def('resource:search', (params: unknown, workspaceId: string | null) => [
    'resource:search',
    params,
    workspaceId,
  ]),
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
  agentLabel: agentLabelKeys,
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
  expertise: expertiseKeys,
  favorite: favoriteKeys,
  file: fileKeys,
  fork: forkKeys,
  gateway: gatewayKeys,
  goal: goalKeys,
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
  stats: statsKeys,
  task: taskKeys,
  taskTemplate: taskTemplateKeys,
  thread: threadKeys,
  tool: toolKeys,
  topic: topicKeys,
  topicComment: topicCommentKeys,
  documentComment: documentCommentKeys,
  topicAction: topicActionKeys,
  user: userKeys,
  userMemory: userMemoryKeys,
  verify: verifyKeys,
  video: videoKeys,
};

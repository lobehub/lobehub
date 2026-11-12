/**
 * Central SWR key registry
 *
 * Frozen: do not add keys. New server data the UI paints goes through
 * `local-replica` (`@/libs/replica`). `keys.frozen.test.ts` fails on any added
 * key; when a key is migrated or removed, delete its entry there too.
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
 */
import { type ConversationContext } from '@lobechat/types';

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

export const channelKeys = {
  agentEnvironment: def(
    'channel:agentEnvironment',
    (channelId: string, memberId: string) =>
      ['channel:agentEnvironment', channelId, memberId] as const,
  ),
  wakeConfig: def(
    'channel:wakeConfig',
    (channelId: string) => ['channel:wakeConfig', channelId] as const,
  ),
  userCandidates: def(
    'channel:userCandidates',
    (channelId: string | undefined, search: string) =>
      ['channel:userCandidates', channelId ?? null, search] as const,
  ),
};

// ---- message ------------------------------------------------------------
export interface MessageListQueryContext {
  agentId?: string | null;
  /** Agent-share visitor surface — routes the read through `shareChat.getMessages`. */
  agentShareId?: string;
  groupId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
  topicShareId?: string;
}

export interface CanonicalMessageListContext {
  agentId: string | null;
  agentShareId?: string;
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
  ...(context.agentShareId === undefined ? {} : { agentShareId: context.agentShareId }),
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
  list: def('topic:list', (containerKey: string, opts: Record<string, unknown>) => [
    'topic:list',
    containerKey,
    opts,
  ]),
  scheduledRunWatch: def('topic:scheduledRunWatch', (topicId: string) => [
    'topic:scheduledRunWatch',
    topicId,
  ]),
  search: def(
    'topic:search',
    (keywords: string, agentId?: string, groupId?: string, onlyMine?: boolean) => [
      'topic:search',
      keywords,
      agentId,
      groupId,
      onlyMine,
    ],
  ),
};

// ---- acceptance collaboration -------------------------------------------
export const acceptanceCollaborationKeys = {
  conversation: def('acceptanceCollaboration:conversation', (acceptanceId: string) => [
    'acceptanceCollaboration:conversation',
    acceptanceId,
  ]),
};

// ---- document comment ---------------------------------------------------
export const documentCommentKeys = {
  anchors: def('documentComment:anchors', (workspaceId: string | null, documentId: string) => [
    'documentComment:anchors',
    workspaceId ?? '',
    documentId,
  ]),
  detail: def('documentComment:detail', (workspaceId: string | null, commentId: string) => [
    'documentComment:detail',
    workspaceId ?? '',
    commentId,
  ]),
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
    (
      workspaceId: string | null,
      documentId: string,
      cursor?: string,
      /** `'anchored'` / `'document'` page one subset; `'all'` pages every root. */
      scope: 'all' | 'anchored' | 'document' = 'all',
    ) => ['documentComment:threads', workspaceId ?? '', documentId, cursor ?? '', scope],
  ),
};

// ---- document like ------------------------------------------------------
export const documentLikeKeys = {
  summary: def('documentLike:summary', (workspaceId: string | null, documentId: string) => [
    'documentLike:summary',
    workspaceId ?? '',
    documentId,
  ]),
};

export const isDocumentCommentKeyForEvent = (
  key: unknown,
  event: { documentId: string; rootCommentId?: string; workspaceId: string },
): boolean => {
  if (!Array.isArray(key)) return false;

  if (key[0] === documentCommentKeys.summary.root) return key[1] === event.documentId;
  if (key[1] !== event.workspaceId) return false;
  // Deep-link detail entries are few (at most a pinned root and reply) and events do not
  // carry the comment id, so revalidate them on any comment event in the workspace.
  if (key[0] === documentCommentKeys.detail.root) return true;
  if (key[0] === documentCommentKeys.threads.root) return key[2] === event.documentId;
  if (key[0] === documentCommentKeys.anchors.root) return key[2] === event.documentId;
  if (key[0] === documentCommentKeys.replies.root) {
    return !event.rootCommentId || key[2] === event.rootCommentId;
  }
  return false;
};

// ---- group --------------------------------------------------------------
export const groupKeys = {
  /** Agent picker for the "create group" modal. */
  queryAgentsForCreate: def('group:queryAgentsForCreate', () => ['group:queryAgentsForCreate']),
};

// ---- thread -------------------------------------------------------------
export const threadKeys = {
  list: def('thread:list', (topicId: string) => ['thread:list', topicId]),
};

/**
 * Goal reads that have no local-first projection: the pending queues are live
 * "what needs you" feeds, and the topic link is a discovery poll.
 *
 * The goal list, the home roll-up, the graph snapshot and the metric series
 * used to live here — they are `local-replica` resources now (see
 * `src/store/goal/projection.ts`), so their sync keys are not SWR cache keys.
 */
export const goalKeys = {
  /** Clarifications waiting on the user across every goal they own. */
  pendingClarifications: def('goal:pendingClarifications', () => ['goal:pendingClarifications']),
  /** Gates and sign-offs waiting on the user across every goal, for the approval island. */
  pendingForIsland: def('goal:pendingForIsland', () => ['goal:pendingForIsland']),
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

// ---- agent config / available / search ----------------------------------
export const agentConfigKeys = {
  search: def('agent:search', (keyword?: string) => ['agent:search', keyword]),
};

// ---- image generation ---------------------------------------------------
// The topic list and the per-topic batches live in `local-replica`
// resources now (see `src/store/image/slices/*/projection.ts`); only the
// generation-status poll is still an SWR key.
export const imageKeys = {
  generationStatus: def('image:generationStatus', (generationId: string, asyncTaskId?: string) => [
    'image:generationStatus',
    generationId,
    asyncTaskId,
  ]),
};

// ---- video generation ---------------------------------------------------
// The topic list and the per-topic batches live in `local-replica`
// resources now (see `src/store/video/slices/*/projection.ts`); only the
// generation-status poll is still an SWR key.
export const videoKeys = {
  generationStatus: def('video:generationStatus', (generationId: string, asyncTaskId?: string) => [
    'video:generationStatus',
    generationId,
    asyncTaskId,
  ]),
};

// ---- serverConfig -------------------------------------------------------
export const serverConfigKeys = {
  get: 'serverConfig:get' as const,
};

// ---- discover (marketplace) ---------------------------------------------
// NOTE: discover/eval/ragEval/knowledgeBase/device/userMemory/file prefixes
// are deliberately kept OUT of `CACHE_TIERS`
// (see localStorageProvider.ts) so this key-convergence introduces no new
// persistence — they stay memory-only exactly as before.
export const discoverKeys = {
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
  datasetRuns: def('eval:datasetRuns', (datasetId: string) => ['eval:datasetRuns', datasetId]),
  runDetail: def('eval:runDetail', (id: string) => ['eval:runDetail', id]),
  runResults: def('eval:runResults', (id: string) => ['eval:runResults', id]),
  runs: def('eval:runs', (benchmarkId?: string) => ['eval:runs', benchmarkId]),
  testCaseDetail: def('eval:testCaseDetail', (id: string) => ['eval:testCaseDetail', id]),
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

// ---- device -------------------------------------------------------------
export const deviceKeys = {
  cliUpdateState: def('device:cliUpdateState', (workspaceId: string | null, deviceId: string) => [
    'device:cliUpdateState',
    workspaceId,
    deviceId,
  ]),
  appUpdateState: def('device:appUpdateState', (workspaceId: string | null, deviceId: string) => [
    'device:appUpdateState',
    workspaceId,
    deviceId,
  ]),
  systemInfo: def('device:systemInfo', (workspaceId: string | null, deviceId: string) => [
    'device:systemInfo',
    workspaceId,
    deviceId,
  ]),
  browseDirectory: def(
    'device:browseDirectory',
    (workspaceId: string | null, deviceId: string, path?: string, cursor?: string) =>
      ['device:browseDirectory', workspaceId, deviceId, path, cursor] as const,
  ),
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
  gitPullRequestDetail: def(
    'device:gitPullRequestDetail',
    (deviceId: string, path: string, number: number) => [
      'device:gitPullRequestDetail',
      deviceId,
      path,
      number,
    ],
  ),
  gitPullRequestActivity: def(
    'device:gitPullRequestActivity',
    (deviceId: string, path: string, number: number) => [
      'device:gitPullRequestActivity',
      deviceId,
      path,
      number,
    ],
  ),
  gitPullRequestMergeContext: def(
    'device:gitPullRequestMergeContext',
    (deviceId: string, path: string, number: number, headRefOid?: string, baseRefName?: string) => [
      'device:gitPullRequestMergeContext',
      deviceId,
      path,
      number,
      ...(headRefOid === undefined ? [] : [headRefOid]),
      ...(baseRefName === undefined ? [] : [baseRefName]),
    ],
  ),
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
  contextStories: def('userMemory:contextStories', () => ['userMemory:contextStories']),
  contextStory: def('userMemory:contextStory', (id: string) => ['userMemory:contextStory', id]),
  experiences: def('userMemory:experiences', (params: unknown) => [
    'userMemory:experiences',
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
};

// ---- global -------------------------------------------------------------
export const globalKeys = {
  latestVersion: def('global:latestVersion', () => ['global:latestVersion']),
  serverVersion: def('global:serverVersion', () => ['global:serverVersion']),
  systemStatus: def('global:systemStatus', () => ['global:systemStatus']),
};

// ---- file ---------------------------------------------------------------
export const fileKeys = {
  ttsFile: def('file:ttsFile', (messageId: string) => ['file:ttsFile', messageId]),
};

// =========================================================================
// UI-layer keys (features / routes / components). Prefixes below stay
// memory-only unless explicitly listed in `CACHE_TIERS`. Names avoid colliding
// with cached prefixes — e.g. share/topic is `share:` not `topic:`, portal
// header is `portal:` not `document:`.
// =========================================================================

// ---- MCP Apps (interactive tool result views) -----------------------------
export const mcpAppKeys = {
  resource: def(
    'mcpApp:resource',
    (
      identifier: string,
      uri: string,
      {
        agentId,
        onThisDevice = false,
        server,
      }: { agentId?: string; onThisDevice?: boolean; server?: string },
    ) => ['mcpApp:resource', identifier, uri, agentId ?? null, onThisDevice, server ?? null],
  ),
};

// ---- api key (settings/apikey) -------------------------------------------
export const apiKeyKeys = {
  list: def('apiKey:list', () => ['apiKey:list']),
};

// ---- messenger / platform integration -----------------------------------
export const messengerKeys = {
  myLink: def('messenger:myLink', (platform: string, tokenScopeKey: string | undefined) => [
    'messenger:myLink',
    platform,
    tokenScopeKey,
  ]),
  peek: def('messenger:peek', (randomId: string) => ['messenger:peek', randomId]),
};

// ---- scm (GitHub App integration) --------------------------------------
export const scmKeys = {
  changeRequests: def('scm:changeRequests', (workspaceId: string | null | undefined) => [
    'scm:changeRequests',
    workspaceId ?? null,
  ]),
  repositories: def('scm:repositories', (workspaceId: string | null | undefined) => [
    'scm:repositories',
    workspaceId ?? null,
  ]),
  wakeTarget: def('scm:wakeTarget', (topicId: string) => ['scm:wakeTarget', topicId]),
};

// ---- verify (deliverable judging) ---------------------------------------
export const verifyKeys = {
  acceptancePurgePreview: def('verify:acceptancePurgePreview', (acceptanceId: string) => [
    'verify:acceptancePurgePreview',
    acceptanceId,
  ]),
  /** The acceptance round an old `/verify/:runId` link redirects to. */
  runAcceptanceRound: def('verify:runAcceptanceRound', (verifyRunId: string) => [
    'verify:runAcceptanceRound',
    verifyRunId,
  ]),
};

// ---- inbox / notifications ----------------------------------------------
export const inboxKeys = {
  unreadCount: def('inbox:unreadCount', (workspaceId: string | null) => [
    'inbox:unreadCount',
    workspaceId,
  ]),
  /** Desktop mention-banner watcher: unread `mention` rows of the active workspace. */
  unreadMentions: def('inbox:unreadMentions', (workspaceId: string | null) => [
    'inbox:unreadMentions',
    workspaceId,
  ]),
};

// ---- share (shared agent / topic / page) ---------------------------------
export const shareKeys = {
  agentInfo: def('share:agentInfo', (slugOrId: string) => ['share:agentInfo', slugOrId]),
  /** Connector lists the creator-side AGENT share tool picker screens, keyed by agentId. */
  agentShareConnectors: def('share:agentShareConnectors', (agentId: string) => [
    'share:agentShareConnectors',
    agentId,
  ]),
  /** Candidates for the creator-side AGENT share skill picker, keyed by agentId. */
  agentShareGrantableSkills: def('share:agentShareGrantableSkills', (agentId: string) => [
    'share:agentShareGrantableSkills',
    agentId,
  ]),
  // Creator-side share status keyed by agentId (visitor side uses `agentInfo`).
  agentShareStats: def('share:agentShareStats', (agentId: string) => [
    'share:agentShareStats',
    agentId,
  ]),
  agentShareEligibleWorks: def(
    'share:agentShareEligibleWorks',
    (agentId: string, offset: number, includeWorkIds: readonly string[]) => [
      'share:agentShareEligibleWorks',
      agentId,
      offset,
      includeWorkIds,
    ],
  ),
  agentShareStatus: def('share:agentShareStatus', (agentId: string) => [
    'share:agentShareStatus',
    agentId,
  ]),
  artifact: def('share:artifact', (id: string) => ['share:artifact', id]),
  file: def('share:file', (shareId: string) => ['share:file', shareId]),
  pageDocument: def('share:pageDocument', (documentId: string) => [
    'share:pageDocument',
    documentId,
  ]),
  topic: def('share:topic', (id: string) => ['share:topic', id]),
  /** The visitor's own topics under an agent share (server-scoped by senderId). */
  visitorTopics: def('share:visitorTopics', (shareId: string) => ['share:visitorTopics', shareId]),
};

// ---- fork source (community detail) -------------------------------------
export const forkKeys = {
  groupSource: def('fork:groupSource', (identifier: string) => ['fork:groupSource', identifier]),
  source: def('fork:source', (identifier: string) => ['fork:source', identifier]),
};

// ---- local file ---------------------------------------------------------
export const localFileKeys = {
  claudeCodeMemory: def(
    'localFile:claudeCodeMemory',
    (
      deviceId: string | undefined,
      workingDirectory: string,
      configDir?: string,
      projectDirName?: string,
    ) => [
      'localFile:claudeCodeMemory',
      deviceId ?? 'local',
      workingDirectory,
      configDir ?? '',
      projectDirName ?? '',
    ],
  ),
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
export const canvasKeys = {
  storage: def('canvas:storage', () => ['canvas:storage']),
};

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

// ---- agent home / profile (kept off the `agent:` idb tier) -----
export const agentHomeKeys = {
  topics: def('agentHome:topics', (agentId: string) => ['agentHome:topics', agentId]),
};

// ---- bot wake records (one bot's judged messages; never persisted) ----
export const botWakeKeys = {
  decisions: def(
    'botWake:decisions',
    (
      botId: string,
      filters: { followupOnly: boolean; outcome?: string; unmarkedOnly: boolean },
      page: number,
    ) => [
      'botWake:decisions',
      botId,
      filters.outcome ?? null,
      filters.followupOnly,
      filters.unmarkedOnly,
      page,
    ],
  ),
  summary: def('botWake:summary', (botId: string) => ['botWake:summary', botId]),
};

// ---- misc UI singletons -------------------------------------------------
export const ollamaKeys = {
  downloadModel: def('ollama:downloadModel', (model: string) => ['ollama:downloadModel', model]),
};
export const authKeys = {
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
export const resourceKeys = {
  list: def('resource:list', (params: unknown, workspaceId: string | null) => [
    'resource:list',
    params,
    workspaceId,
  ]),
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
  clientLlmWaits: def('gateway:clientLlmWaits', () => ['gateway:clientLlmWaits']),
  reconnect: def('gateway:reconnect', (operationId: string) => ['gateway:reconnect', operationId]),
};
export const userKeys = {
  checkTrace: def('user:checkTrace', () => ['user:checkTrace']),
};
export const imessageKeys = {
  bridgeStatus: def('imessage:bridgeStatus', () => ['imessage:bridgeStatus']),
};
// Desktop/electron IPC fetches — roots keep their existing `electron:getXxx` value.
export const electronKeys = {
  /** Claude Code logins held on this machine (device-local, never persisted). */
  claudeCodeAccounts: def('electron:claudeCodeAccounts', () => ['electron:claudeCodeAccounts']),
  appMenu: def('electron:getAppMenu', () => ['electron:getAppMenu']),
  appTrayVisible: def('electron:getAppTrayVisible', () => ['electron:getAppTrayVisible']),
  desktopHotkeys: def('electron:getDesktopHotkeys', () => ['electron:getDesktopHotkeys']),
  gatewayDeviceInfo: def('electron:getGatewayDeviceInfo', () => ['electron:getGatewayDeviceInfo']),
  proxySettings: def('electron:getProxySettings', () => ['electron:getProxySettings']),
  remoteServerConfig: def('electron:getRemoteServerConfig', () => [
    'electron:getRemoteServerConfig',
  ]),
  /** This machine's derived device id in a workspace (local, no network). */
  workspaceDeviceId: def('electron:getWorkspaceDeviceId', (workspaceId: string) => [
    'electron:getWorkspaceDeviceId',
    workspaceId,
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
export const taskLabelKeys = {
  list: def('taskLabel:list', () => ['taskLabel:list'] as const),
};

export const swrKeys = {
  agent: agentConfigKeys,
  agentHome: agentHomeKeys,
  auth: authKeys,
  canvas: canvasKeys,
  changelog: changelogKeys,
  cron: cronKeys,
  device: deviceKeys,
  discover: discoverKeys,
  electron: electronKeys,
  eval: evalKeys,
  favorite: favoriteKeys,
  file: fileKeys,
  fork: forkKeys,
  gateway: gatewayKeys,
  goal: goalKeys,
  global: globalKeys,
  group: groupKeys,
  image: imageKeys,
  imessage: imessageKeys,
  inbox: inboxKeys,
  localFile: localFileKeys,
  message: messageKeys,
  messenger: messengerKeys,
  scm: scmKeys,
  ollama: ollamaKeys,
  onboarding: onboardingKeys,
  openInApp: openInAppKeys,
  ragEval: ragEvalKeys,
  recommendations: recommendationsKeys,
  resource: resourceKeys,
  serverConfig: serverConfigKeys,
  share: shareKeys,
  taskLabel: taskLabelKeys,
  thread: threadKeys,
  tool: toolKeys,
  topic: topicKeys,
  acceptanceCollaboration: acceptanceCollaborationKeys,
  documentComment: documentCommentKeys,
  documentLike: documentLikeKeys,
  topicAction: topicActionKeys,
  user: userKeys,
  userMemory: userMemoryKeys,
  verify: verifyKeys,
  video: videoKeys,
};

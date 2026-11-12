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
 * - Consistent, discoverable naming (`swrKeys.topic.search(...)`).
 * - The `domain:` prefix lets callers refresh a whole domain at once via
 *   `matchDomain('topic:')`.
 *
 * SWR keeps these entries in memory only: there is no cache provider and
 * nothing here is persisted. Data that must paint from a local copy on a cold
 * start is a replica (`@/libs/replica`), not an SWR key.
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

/** Message key schema version. Version 2 canonicalizes the query context. */
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

// ---- RAG eval -----------------------------------------------------------
export const ragEvalKeys = {
  datasetList: def('ragEval:datasetList', (knowledgeBaseId?: string) => [
    'ragEval:datasetList',
    knowledgeBaseId,
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

// ---- global -------------------------------------------------------------
export const globalKeys = {
  latestVersion: def('global:latestVersion', () => ['global:latestVersion']),
  serverVersion: def('global:serverVersion', () => ['global:serverVersion']),
  systemStatus: def('global:systemStatus', () => ['global:systemStatus']),
};

// =========================================================================
// UI-layer keys (features / routes / components). Names avoid colliding with
// domain prefixes refreshed through `matchDomain` — e.g. share/topic is
// `share:` not `topic:`, portal header is `portal:` not `document:`.
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
  artifact: def('share:artifact', (id: string) => ['share:artifact', id]),
  file: def('share:file', (shareId: string) => ['share:file', shareId]),
  pageDocument: def('share:pageDocument', (documentId: string) => [
    'share:pageDocument',
    documentId,
  ]),
  topic: def('share:topic', (id: string) => ['share:topic', id]),
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

// ---- canvas -------------------------------------------------------------
export const canvasKeys = {
  storage: def('canvas:storage', () => ['canvas:storage']),
};

// ---- changelog ----------------------------------------------------------
export const changelogKeys = {
  modalIndex: def('changelog:modalIndex', () => ['changelog:modalIndex']),
  post: def('changelog:post', (id: string, locale: string) => ['changelog:post', id, locale]),
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
  auth: authKeys,
  canvas: canvasKeys,
  changelog: changelogKeys,
  cron: cronKeys,
  device: deviceKeys,
  electron: electronKeys,
  gateway: gatewayKeys,
  goal: goalKeys,
  global: globalKeys,
  image: imageKeys,
  imessage: imessageKeys,
  inbox: inboxKeys,
  localFile: localFileKeys,
  message: messageKeys,
  messenger: messengerKeys,
  scm: scmKeys,
  ollama: ollamaKeys,
  openInApp: openInAppKeys,
  ragEval: ragEvalKeys,
  recommendations: recommendationsKeys,
  serverConfig: serverConfigKeys,
  share: shareKeys,
  taskLabel: taskLabelKeys,
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

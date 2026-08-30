// Note: To make the code more logic and readable, we just disable the auto sort key eslint rule
// DON'T REMOVE THE FIRST LINE
import { TRACING_SCENARIOS } from '@lobechat/const';
import {
  chainSummaryTitle,
  TOPIC_TITLE_JSON_SCHEMA,
  TOPIC_TITLE_PROMPT_VERSION,
} from '@lobechat/prompts';
import { type ChatTopicMetadata, type MessageMapScope, type UIChatMessage } from '@lobechat/types';
import { toast } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { t } from 'i18next';
import { type SWRResponse } from 'swr';

import { LOADING_FLAT } from '@/const/message';
import { mutate, useClientDataSWRWithSync } from '@/libs/swr';
import { cronKeys, deviceKeys, projectionKeys, topicKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import {
  executeProjectionRequest,
  getProjectionStoreState,
  nextProjectionObservedAt,
  selectChatTopicListItem,
  selectChatTopicProjectionIds,
  selectChatTopicsIndex,
} from '@/projection';
import { type ChatTopicDispatch } from '@/projection/modules/chat/mutation';
import { chatTopicsPageProjectionQuery } from '@/projection/modules/chat/queries';
import { aiChatService } from '@/services/aiChat';
import { type GitLinkedPRSummary, gitService } from '@/services/git';
import { messageService } from '@/services/message';
import type { TopicBatchDeleteScope } from '@/services/topic';
import { topicService } from '@/services/topic';
import { type ChatStore } from '@/store/chat';
import { evictMessageCache } from '@/store/chat/utils/evictMessageCache';
import { snapshotAgentModel } from '@/store/chat/utils/snapshotAgentModel';
import { topicMapKey, type TopicMapScope } from '@/store/chat/utils/topicMapKey';
import {
  canReadTopicGitTransport,
  getTopicLinkedPullRequestBase,
  isSuccessfulLinkedPullRequestLookup,
  mergeWorkingDirGithubState,
  resolveTopicGitTransport,
  toWorkingDirGithubState,
} from '@/store/chat/utils/topicWorkingDirGit';
import { useGlobalStore } from '@/store/global';
import { getHomeStoreState } from '@/store/home';
import { type StoreSetter } from '@/store/types';
import { useUserStore } from '@/store/user';
import {
  systemAgentSelectors,
  userGeneralSettingsSelectors,
  userProfileSelectors,
} from '@/store/user/selectors';
import { type ChatTopic, type ChatTopicStatus, type CreateTopicParams } from '@/types/topic';
import { setNamespace } from '@/utils/storeDebug';

import { displayMessageSelectors } from '../message/selectors';
import {
  getChatTopicById,
  getChatTopicContainerKeyById,
  getChatTopics,
  getCurrentChatTopics,
  topicsWithoutCron,
} from './projection';
import { topicSelectors } from './selectors';

const n = setNamespace('t');

const STALE_RUNNING_TOPIC_TIMEOUT = 2 * 60 * 60 * 1000;
const STALE_RUNNING_TOPIC_QUERY_PAGE_SIZE = 500;

/**
 * Max message prefetches fired per topic-list fetch for freshly-unread topics.
 * Bounds the fan-out after a long-offline boot; see
 * `#prefetchUnreadTopicMessages`.
 */
const UNREAD_TOPIC_PREFETCH_LIMIT = 5;

type CronTopicsGroupWithJobInfo = {
  cronJob: unknown;
  cronJobId: string;
  topics: ChatTopic[];
};

type RunningTopicForWatchdog = Omit<ChatTopic, 'updatedAt'> & {
  agentId?: string | null;
  groupId?: string | null;
  updatedAt: Date | number | string;
};

type TopicPatchScope = {
  agentId?: string;
  groupId?: string;
  scope?: TopicMapScope;
};

/**
 * Options for switchTopic action
 */
export interface SwitchTopicOptions {
  /**
   * Clear the _new key data even when switching to an existing topic
   * This is useful when creating a new topic, where the _new key data should be cleared
   * @default false
   */
  clearNewKey?: boolean;
  /**
   * Explicit scope for clearing new key data
   * If not provided, will be inferred from store state (activeGroupId)
   */
  scope?: MessageMapScope;
  /**
   * Skip refreshing messages after switching topic
   * @default false
   */
  skipRefreshMessage?: boolean;
}

export interface RemoveUnstarredTopicOptions {
  /** Restrict the bulk delete to topics created by the signed-in user. */
  onlyOwn?: boolean;
}

type Setter = StoreSetter<ChatStore>;

interface TopicLinkedPullRequestRefreshParams {
  branch: string;
  deviceId?: string;
  path: string;
  pullRequestNumber?: number;
  topicId: string;
}

export const chatTopic = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new ChatTopicActionImpl(set, get, _api);

export class ChatTopicActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  // Monotonic token for switchTopic. Each call increments it and captures a
  // local copy; after awaited work, a mismatch means a newer switch has
  // started and our continuation is stale — drop it rather than let it
  // clobber the newer topic (see ).
  #switchTopicEpoch = 0;

  #staleRunningTopicCleanupInFlight = false;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  #resolveTopicLinkedPullRequestRefreshParams = (
    topicId: string,
    metadata?: ChatTopicMetadata,
  ): TopicLinkedPullRequestRefreshParams | undefined => {
    const sourceMetadata = metadata ?? getChatTopicById(topicId)?.metadata;
    const base = getTopicLinkedPullRequestBase(sourceMetadata);
    if (!base) return undefined;

    const { activeAgentId } = this.#get();
    if (!activeAgentId) return undefined;

    const transport = resolveTopicGitTransport(activeAgentId);
    if (!canReadTopicGitTransport(transport)) return undefined;

    return {
      branch: base.branch,
      deviceId: transport.deviceId,
      path: base.path,
      pullRequestNumber: base.pullRequestNumber,
      topicId,
    };
  };

  closeAllTopicsDrawer = (): void => {
    this.#set({ allTopicsDrawerOpen: false }, false, n('closeAllTopicsDrawer'));
  };

  openAllTopicsDrawer = (): void => {
    this.#set({ allTopicsDrawerOpen: true }, false, n('openAllTopicsDrawer'));
  };

  openNewTopicOrSaveTopic = async (): Promise<void> => {
    const { switchTopic, saveToTopic, refreshMessages, activeTopicId } = this.#get();
    const hasTopic = !!activeTopicId;

    if (hasTopic) switchTopic(null);
    else {
      // A send from the new-topic view may still be in flight (the `_new`
      // context holds only optimistic tmp_* messages while the run itself
      // creates the real topic). Saving here would archive those tmp ids into
      // a spurious "Default Topic" and race the in-flight topic creation,
      // leaving the real topic's loading state stuck until reload. Skip:
      // the running send owns topic creation. Entry buttons are disabled via
      // the same selector, so this guard only backstops hotkey/command paths.
      if (topicSelectors.isNewTopicSendInFlight(this.#get())) return;

      await saveToTopic();
      refreshMessages();
    }
  };

  createTopic = async (sessionId?: string): Promise<string | undefined> => {
    const { activeAgentId, internal_createTopic } = this.#get();

    const messages = displayMessageSelectors.activeDisplayMessages(this.#get());

    this.#set({ creatingTopic: true }, false, n('creatingTopic/start'));
    const targetSessionId = sessionId || activeAgentId;
    const topicId = await internal_createTopic({
      ...snapshotAgentModel(targetSessionId),
      title: t('defaultTitle', { ns: 'topic' }),
      messages: messages.map((m) => m.id),
      sessionId: targetSessionId,
    });
    this.#set({ creatingTopic: false }, false, n('creatingTopic/end'));

    return topicId;
  };

  saveToTopic = async (sessionId?: string): Promise<string | undefined> => {
    // if there is no message, stop
    const messages = displayMessageSelectors.activeDisplayMessages(this.#get());
    if (messages.length === 0) return;

    const { activeAgentId, summaryTopicTitle, internal_createTopic } = this.#get();
    const targetSessionId = sessionId || activeAgentId;

    // 1. create topic and bind these messages
    const topicId = await internal_createTopic({
      ...snapshotAgentModel(targetSessionId),
      title: t('defaultTitle', { ns: 'topic' }),
      messages: messages.map((m) => m.id),
      sessionId: targetSessionId,
    });

    // 2. auto summary topic Title — fire-and-forget; the title streams into the
    // row as it generates, no separate loading affordance needed.
    void summaryTopicTitle(topicId, messages).catch((error) => {
      console.error('[saveToTopic] Failed to summarize topic title:', error);
    });

    return topicId;
  };

  duplicateTopic = async (id: string): Promise<void> => {
    const { refreshTopic, switchTopic } = this.#get();

    const topic = getChatTopicById(id);
    if (!topic) return;

    const newTitle = t('duplicateTitle', { ns: 'chat', title: topic?.title });

    const loadingToast = toast.loading(t('duplicateLoading', { ns: 'topic' }));

    const newTopicId = await topicService.cloneTopic(id, newTitle);
    await refreshTopic();
    loadingToast.close();
    toast.success(t('duplicateSuccess', { ns: 'topic' }));

    await switchTopic(newTopicId);
  };

  importTopic = async (data: string): Promise<string | undefined> => {
    const { activeAgentId, activeGroupId, refreshTopic, switchTopic } = this.#get();

    if (!activeAgentId) return;

    const loadingToast = toast.loading(t('importLoading', { ns: 'topic' }));

    try {
      const result = await topicService.importTopic({
        agentId: activeAgentId,
        data,
        groupId: activeGroupId,
      });

      await refreshTopic();
      loadingToast.close();
      toast.success(t('importSuccess', { count: result.messageCount, ns: 'topic' }));

      await switchTopic(result.topicId);

      return result.topicId;
    } catch (error) {
      loadingToast.close();
      toast.error(t('importError', { ns: 'topic' }));
      console.error('[importTopic] Failed:', error);
      return undefined;
    }
  };

  summaryTopicTitle = async (topicId: string, messages: UIChatMessage[]): Promise<void> => {
    const { internal_updateTopicTitleInSummary } = this.#get();
    const topic = getChatTopicById(topicId);
    if (!topic) return;

    // Keep an optimistic title like "阅读下面..." stable while AI rename runs;
    // otherwise the sidebar flickers `title -> ... -> final title`.
    const shouldShowPlaceholder = !topic.title || topic.title === LOADING_FLAT;

    if (shouldShowPlaceholder) internal_updateTopicTitleInSummary(topicId, LOADING_FLAT);

    const restorePreviousTitle = () => {
      if (shouldShowPlaceholder) internal_updateTopicTitleInSummary(topicId, topic.title);
    };

    // Get current agent for topic
    const { model, provider } = systemAgentSelectors.topic(useUserStore.getState());

    // Structured generation, the same way `SystemAgentService.generateTopicTitle`
    // does it: the chain asks for `TOPIC_TITLE_JSON_SCHEMA`, so read the title
    // off the parsed object. Streaming a completion here used to write the raw
    // answer to `topic.title`, which named topics `{"title":"简单问候"}`.
    try {
      const { data } = await aiChatService.generateJSON(
        {
          ...chainSummaryTitle(
            messages,
            userGeneralSettingsSelectors.currentResponseLanguage(useUserStore.getState()),
          ),
          model,
          provider,
          schema: TOPIC_TITLE_JSON_SCHEMA,
          tracing: {
            promptVersion: TOPIC_TITLE_PROMPT_VERSION,
            scenario: TRACING_SCENARIOS.TopicTitle,
            schemaName: TOPIC_TITLE_JSON_SCHEMA.name,
            topicId,
          },
        },
        new AbortController(),
      );

      const title = (data as { title?: string } | undefined)?.title?.trim();
      // An empty result must not blank the title — the placeholder would
      // otherwise stay in the sidebar forever.
      if (!title) return restorePreviousTitle();

      await this.#get().internal_updateTopic(topicId, { title });
    } catch (error) {
      console.error('[summaryTopicTitle] failed to generate a title:', error);
      restorePreviousTitle();
    }
  };

  markTopicCompleted = async (id: string): Promise<void> => {
    await this.#get().internal_updateTopic(id, {
      completedAt: new Date(),
      status: 'completed',
    });
  };

  unmarkTopicCompleted = async (id: string): Promise<void> => {
    await this.#get().internal_updateTopic(id, {
      completedAt: null,
      status: 'active',
    });
  };

  favoriteTopic = async (id: string, favorite: boolean): Promise<void> => {
    const { activeAgentId } = this.#get();
    await this.#get().internal_updateTopic(id, { favorite });

    if (!activeAgentId) return;

    await mutate(
      cronKeys.topicsWithJobInfo(activeAgentId),
      (groups?: CronTopicsGroupWithJobInfo[]) => {
        if (!Array.isArray(groups)) return groups;

        let updated = false;
        const next = groups.map((group) => {
          let groupUpdated = false;
          const topics = Array.isArray(group.topics)
            ? group.topics.map((topic) => {
                if (topic.id !== id) return topic;
                if (topic.favorite === favorite) return topic;
                groupUpdated = true;
                updated = true;
                return { ...topic, favorite };
              })
            : [];

          return groupUpdated ? { ...group, topics } : group;
        });

        return updated ? next : groups;
      },
      { revalidate: false },
    );
  };

  updateTopicMetadata = async (id: string, metadata: Partial<ChatTopicMetadata>): Promise<void> => {
    const topic = getChatTopicById(id);
    if (!topic) return;

    // Optimistic update with merged metadata
    const mergedMetadata = { ...topic.metadata, ...metadata };
    this.#get().internal_dispatchTopic({
      type: 'updateTopic',
      id,
      value: { metadata: mergedMetadata },
    });

    await topicService.updateTopicMetadata(id, metadata);
    await this.#get().refreshTopic();
  };

  updateTopicTitle = async (id: string, title: string): Promise<void> => {
    const projectionScope = getCacheScope();
    const observedAt = nextProjectionObservedAt();
    await this.#get().internal_updateTopic(id, { title });
    getProjectionStoreState().updateTopicProjectionTitle(projectionScope, id, title, observedAt);
  };

  /**
   * Pin a model to a topic by writing the top-level `topics.model`/`provider`
   * columns (the config source of truth), NOT metadata. Called when the user
   * switches model while a topic is active so each topic keeps its own model
   * (see the ChatInput Model control); generation + ChatInput display read it
   * back via `topicSelectors.getTopicModelById`.
   */
  updateTopicModel = async (
    id: string,
    { model, provider }: { model: string; provider: string },
  ): Promise<void> => {
    await this.#get().internal_updateTopic(id, { model, provider });
  };

  /**
   * Warm the message cache for topics whose status just flipped to `unread` in
   * a fetched topic list — i.e. runs that completed remotely / on another
   * device / while the app was closed. Their local message bucket typically
   * holds only the creation-time seed (the first user message), so without a
   * prefetch the first click renders that partial list until the switch-time
   * revalidation lands.
   *
   * Store-level on purpose: the sidebar item's own unread-prefetch effect only
   * fires while that item is MOUNTED, which misses collapsed groups and rows
   * outside the virtualized viewport. Locally-run topics don't need this path —
   * streaming already filled their bucket, and `prefetchMessages`' running
   * guard skips them while the terminal bookkeeping is still in flight.
   *
   * Capped so a boot after days offline doesn't fan out a request storm; the
   * uncapped remainder still self-heals on click via the switch revalidation.
   * `prefetchMessages` itself dedupes concurrent calls and skips
   * server-verified or running contexts, so repeated onData fires are cheap.
   */
  prefetchUnreadTopicMessages = (
    fetchedTopics: ChatTopic[],
    previousItems: ChatTopic[] | undefined,
    context: { agentId?: string | null; groupId?: string | null },
  ): void => {
    // Message buckets for group scopes key on more than agentId/topicId; the
    // canonical message:list prefetch only represents plain agent topics.
    if (!context.agentId || context.groupId) return;

    const previousStatus = new Map(previousItems?.map((item) => [item.id, item.status]) ?? []);
    // First load (no previous items) sweeps every unread topic — those runs
    // finished while the app was closed and nothing else will warm them.
    const flipped = fetchedTopics.filter(
      (item) => item.status === 'unread' && previousStatus.get(item.id) !== 'unread',
    );

    for (const topic of flipped.slice(0, UNREAD_TOPIC_PREFETCH_LIMIT)) {
      void this.#get().prefetchMessages({
        agentId: context.agentId,
        scope: 'main',
        topicId: topic.id,
      });
    }
  };

  /**
   * Persist the topic's status. Optimistically patches the in-memory map so
   * the sidebar reflects the change immediately; persistence runs
   * fire-and-forget so a transient network blip never tears down the agent
   * run that owns the write.
   *
   * Pass `agentId`/`groupId` when the call originates from an agent run
   * rather than the active UI — without them, the lookup falls back to the
   * currently active agent, and a status write arriving after the user has
   * switched agents lands in the wrong bucket. The DB write is unconditional
   * so even if no bucket is loaded for this topic, the next refetch picks
   * up the persisted status.
   */
  updateTopicStatus = async (params: {
    agentId?: string;
    groupId?: string;
    scope?: TopicMapScope;
    status: ChatTopicStatus;
    topicId: string;
  }): Promise<void> => {
    const { topicId, status } = params;
    const topic = getChatTopicById(topicId);
    const projectionScope = getCacheScope();

    getProjectionStoreState().updateTopicProjectionStatus(projectionScope, topicId, status);

    // Already at the target status — both the in-memory and DB writes are no-ops.
    if (topic?.status === status) return;

    this.internal_pinTopicStatus(params);

    // "Archive" in the UI writes status:'completed'. Stamp `completedAt` on that
    // transition so bulk/stale archive records when the topic was completed,
    // matching the single-item `markTopicCompleted`. Other status transitions
    // (agent runs → running/active/unread/…) leave `completedAt` untouched.
    const patch: Partial<ChatTopic> =
      status === 'completed' ? { completedAt: new Date(), status } : { status };

    await topicService.updateTopic(topicId, patch).catch((err) => {
      console.error('[updateTopicStatus] persist failed:', err);
      getProjectionStoreState().clearChatTopicStatusWrite(projectionScope, topicId);
      void mutate(projectionKeys.inboxTopics(projectionScope));
    });
  };

  /**
   * Local-only half of {@link updateTopicStatus}: registers the optimistic
   * pending-write pin and dispatches the in-memory patch, without persisting
   * to the server.
   *
   * For completion paths that already have their own ownership-guarded
   * server write (e.g. the gateway transport's `settleRunningOperation`,
   * compared under a row lock by operation id) and only need to mirror the
   * outcome locally — calling `updateTopicStatus` there would add a second,
   * unguarded `topicService.updateTopic` write that could stomp a newer run's
   * status. Skipping the pin entirely instead (a bare `internal_dispatchTopic`)
   * is also wrong: a topic-list refetch racing in behind this write has no
   * signal that a fresher status just landed, and `#reconcileFetchedTopics`
   * would happily reapply the older pending write (e.g. the 'running' pin set
   * when the run started) right back over it, stranding the sidebar spinner
   * again until that pin expires.
   */
  internal_pinTopicStatus = (params: {
    agentId?: string;
    groupId?: string;
    scope?: TopicMapScope;
    status: ChatTopicStatus;
    topicId: string;
  }): void => {
    const { topicId, status, agentId, groupId, scope } = params;
    const state = this.#get();
    const topic = getChatTopicById(topicId);

    if (topic?.status === status) return;

    const patch: Partial<ChatTopic> =
      status === 'completed' ? { completedAt: new Date(), status } : { status };

    getProjectionStoreState().pinChatTopicStatusWrite(
      getCacheScope(),
      topicId,
      status,
      Date.now() + 15_000,
    );

    state.internal_dispatchTopic({
      type: 'updateTopic',
      id: topicId,
      value: patch,
      agentId,
      groupId,
      scope,
    });
  };

  #getTopicUpdatedAt = (topic: RunningTopicForWatchdog): number | undefined => {
    const timestamp =
      typeof topic.updatedAt === 'number' ? topic.updatedAt : new Date(topic.updatedAt).getTime();

    return Number.isFinite(timestamp) ? timestamp : undefined;
  };

  #hasAliveOperationForTopic = (topicId: string): boolean => {
    const operations = Object.values(this.#get().operations);

    return operations.some((operation) => {
      if (operation.status !== 'running') return false;
      if (operation.metadata.isAborting) return false;
      if (operation.abortController.signal.aborted) return false;

      return operation.context.topicId === topicId;
    });
  };

  #getStaleRunningTopicPatchScope = (topic: RunningTopicForWatchdog): TopicPatchScope => {
    const groupId = topic.groupId ?? undefined;

    // Group main topic rows are persisted with the supervisor agentId, but the
    // sidebar topic bucket is `group_${groupId}`. Patch that bucket explicitly
    // instead of falling into `group_agent_${groupId}_${agentId}`.
    if (groupId) return { groupId, scope: 'group' };

    return { agentId: topic.agentId ?? undefined };
  };

  #clearStaleRunningOperationMetadata = async (
    topic: RunningTopicForWatchdog,
    patchScope: TopicPatchScope,
  ): Promise<void> => {
    if (!topic.metadata?.runningOperation) return;

    const metadata = getChatTopicById(topic.id)?.metadata ?? topic.metadata;

    await topicService.updateTopicMetadata(topic.id, { runningOperation: null });

    this.#get().internal_dispatchTopic({
      ...patchScope,
      id: topic.id,
      type: 'updateTopic',
      value: { metadata: { ...metadata, runningOperation: null } },
    });
  };

  cleanupStaleRunningTopics = async (): Promise<number> => {
    if (this.#staleRunningTopicCleanupInFlight) return 0;

    this.#staleRunningTopicCleanupInFlight = true;

    try {
      const runningTopics = (await topicService.queryTopics({
        pageSize: STALE_RUNNING_TOPIC_QUERY_PAGE_SIZE,
        statuses: ['running'],
      })) as RunningTopicForWatchdog[];

      const now = Date.now();
      const staleTopics = runningTopics.filter((topic) => {
        const updatedAt = this.#getTopicUpdatedAt(topic);
        if (!updatedAt) return false;
        if (now - updatedAt <= STALE_RUNNING_TOPIC_TIMEOUT) return false;

        return !this.#hasAliveOperationForTopic(topic.id);
      });

      const cleanedResults = await Promise.all(
        staleTopics.map(async (topic) => {
          try {
            const patchScope = this.#getStaleRunningTopicPatchScope(topic);

            await this.#clearStaleRunningOperationMetadata(topic, patchScope);

            await this.updateTopicStatus({
              ...patchScope,
              status: 'active',
              topicId: topic.id,
            });

            return true;
          } catch (err) {
            console.error('[cleanupStaleRunningTopics] retire stale topic failed:', err);
            return false;
          }
        }),
      );

      const cleanedCount = cleanedResults.filter(Boolean).length;

      if (cleanedCount > 0) {
        void getHomeStoreState().refreshAgentList?.();
      }

      return cleanedCount;
    } catch (err) {
      console.error('[cleanupStaleRunningTopics] failed:', err);
      return 0;
    } finally {
      this.#staleRunningTopicCleanupInFlight = false;
    }
  };

  /**
   * Re-read a `scheduled` topic from the server and fold any dispatch back into
   * the store. The cron dispatcher (`scheduledTopicDispatch`) mutates only the
   * DB when `runAt` passes — status → 'running', `scheduledRun` cleared,
   * `runningOperation` seeded, the parked error card cleared off the failed
   * message — and no push channel tells a client that is already sitting on the
   * topic. This is the pull side: `useScheduledRunWatch` calls it on topic entry
   * and on a short poll around `runAt`.
   *
   * When the server has moved past `scheduled`, the fresh row is patched into
   * the topic map (so `useGatewayReconnect` sees `runningOperation` and attaches
   * to the live stream) and the message list is refetched (so the stale
   * rate-limit card drops and the continuation's assistant row appears).
   *
   * Returns whether a dispatch was observed and folded in.
   */
  syncScheduledTopicRun = async (topicId: string): Promise<boolean> => {
    const stored = getChatTopicById(topicId);
    // Only a topic the store believes is parked needs syncing; anything else
    // already has a live update path (or isn't loaded in the active bucket).
    if (stored?.status !== 'scheduled') return false;

    const scope = getCacheScope();
    const observedAt = nextProjectionObservedAt();
    const fetched = await topicService.getTopicDetail(topicId);
    if (!fetched) {
      getProjectionStoreState().deleteChatTopicProjections(scope, [topicId], observedAt);
      return false;
    }

    // Same funnel every other server-sourced row goes through. It matters most
    // here: `updateTopicStatus` dispatches `scheduled` optimistically and
    // persists afterwards, and that dispatch is what arms this watch — so this
    // fetch routinely overtakes the write and answers with the PRE-schedule row.
    // Unreconciled, folding it in would revert the schedule the user just made
    // (the button reading as a no-op until pressed a second time). The pin is
    // dropped when the persist fails, so a write that never reached the DB
    // still reverts here.
    const [fresh] = getProjectionStoreState().commitChatTopicRecords(scope, [fetched], {
      observedAt,
      source: 'network',
    });
    if (fresh.status !== fetched.status) return false;
    const projectionScope = getProjectionStoreState().scopes[scope];
    const resolvedFresh = projectionScope
      ? selectChatTopicListItem(projectionScope, topicId)
      : undefined;
    if (!resolvedFresh) return false;

    // Server still parked — nothing to fold in.
    if (resolvedFresh.status === 'scheduled' && resolvedFresh.metadata?.scheduledRun) return false;

    // Re-check after the await: a topic/agent switch mid-flight means the
    // active bucket no longer holds this row. The Projection bridge has already
    // materialized `resolvedFresh`, so checking for the old `scheduled` value
    // (and dispatching a second copy) would incorrectly turn a successful sync
    // into a no-op.
    if (!getChatTopicById(topicId)) return false;

    // The dispatcher also rewrote messages before handing off (cleared/deleted
    // the failed step, created the continuation's placeholder), so the list
    // must be refetched before the gateway reconnect anchors on it.
    await this.#get().refreshMessages();

    return true;
  };

  useFetchTopicLinkedPullRequest = (
    topicId?: string,
    metadata?: ChatTopicMetadata,
  ): SWRResponse<GitLinkedPRSummary | undefined> => {
    const params = topicId
      ? this.#resolveTopicLinkedPullRequestRefreshParams(topicId, metadata)
      : undefined;

    return useClientDataSWRWithSync<GitLinkedPRSummary | undefined>(
      params
        ? deviceKeys.gitLinkedPR(
            params.deviceId ?? 'local',
            params.path,
            params.branch,
            params.pullRequestNumber,
          )
        : null,
      params
        ? () =>
            gitService.getLinkedPullRequest({
              branch: params.branch,
              deviceId: params.deviceId,
              path: params.path,
              pullRequestNumber: params.pullRequestNumber,
            })
        : null,
      {
        dedupingInterval: 60 * 1000,
        focusThrottleInterval: 60 * 1000,
        onData: (prData) => {
          if (!params) return;

          void this.#get()
            .internal_updateTopicLinkedPullRequest(params, prData)
            .catch((error) => {
              console.error('[useFetchTopicLinkedPullRequest] sync failed:', error);
            });
        },
        revalidateOnFocus: true,
        shouldRetryOnError: false,
      },
    );
  };

  autoRenameTopicTitle = async (id: string): Promise<void> => {
    const { activeAgentId: agentId, summaryTopicTitle } = this.#get();

    const messages = await messageService.getMessages({ agentId, topicId: id });

    await summaryTopicTitle(id, messages);
  };

  loadMoreAgentTopicsView = async (): Promise<void> => {
    const { activeAgentId, agentTopicsLoadMoreStateMap } = this.#get();
    if (!activeAgentId) return;

    const key = topicMapKey({ agentId: activeAgentId });
    const projectionScopeName = getCacheScope();
    const index = selectChatTopicsIndex(
      getProjectionStoreState().scopes[projectionScopeName],
      'agentView',
      key,
    );
    const requestState = agentTopicsLoadMoreStateMap[key];
    if (!index || index.total <= index.refs.length || requestState?.isLoadingMore) return;

    const nextPage = (index.page ?? 0) + 1;
    const pageSize = index.persistRefLimit;

    this.#set(
      {
        agentTopicsLoadMoreStateMap: {
          ...agentTopicsLoadMoreStateMap,
          [key]: { isLoadingMore: true, loadMoreError: undefined },
        },
      },
      false,
      n('loadMoreAgentTopicsView(start)'),
    );

    try {
      await executeProjectionRequest(
        chatTopicsPageProjectionQuery,
        {
          containerKey: key,
          context: { agentId: activeAgentId },
          page: nextPage,
          pageSize,
          request: {
            agentId: activeAgentId,
            current: nextPage,
            pageSize,
            ...index.signature,
          },
          signature: index.signature,
          surface: 'agentView',
        },
        projectionScopeName,
      );
      if (projectionScopeName !== getCacheScope()) return;

      this.#set(
        {
          agentTopicsLoadMoreStateMap: {
            ...this.#get().agentTopicsLoadMoreStateMap,
            [key]: { isLoadingMore: false, loadMoreError: undefined },
          },
        },
        false,
        n('loadMoreAgentTopicsView(success)'),
      );
    } catch (error) {
      this.#set(
        {
          agentTopicsLoadMoreStateMap: {
            ...this.#get().agentTopicsLoadMoreStateMap,
            [key]: {
              isLoadingMore: false,
              loadMoreError: error,
            },
          },
        },
        false,
        n('loadMoreAgentTopicsView(error)'),
      );
    }
  };

  refreshAgentTopicsView = async (): Promise<void> => {
    const { activeAgentId } = this.#get();
    if (!activeAgentId) return;
    const containerKey = topicMapKey({ agentId: activeAgentId });
    await mutate(
      (key) => Array.isArray(key) && key[0] === topicKeys.agentView.root && key[1] === containerKey,
    );
  };

  loadMoreTopics = async (): Promise<void> => {
    const { activeAgentId, activeGroupId, topicLoadMoreStateMap } = this.#get();
    const key = topicMapKey({ agentId: activeAgentId, groupId: activeGroupId });
    const projectionScopeName = getCacheScope();
    const index = selectChatTopicsIndex(
      getProjectionStoreState().scopes[projectionScopeName],
      'sidebar',
      key,
    );
    const requestState = topicLoadMoreStateMap[key];
    if (
      (!activeAgentId && !activeGroupId) ||
      !index ||
      index.total <= index.refs.length ||
      requestState?.isLoadingMore
    )
      return;

    const nextPage = (index.page ?? 0) + 1;

    this.#set(
      {
        topicLoadMoreStateMap: {
          ...topicLoadMoreStateMap,
          [key]: { isLoadingMore: true, loadMoreError: undefined },
        },
      },
      false,
      n('loadMoreTopics(start)'),
    );

    try {
      const pageSize =
        index.persistRefLimit || useGlobalStore.getState().status.topicPageSize || 20;
      await executeProjectionRequest(
        chatTopicsPageProjectionQuery,
        {
          containerKey: key,
          context: { agentId: activeAgentId ?? null, groupId: activeGroupId ?? null },
          page: nextPage,
          pageSize,
          request: {
            agentId: activeAgentId,
            current: nextPage,
            groupId: activeGroupId,
            pageSize,
            ...index.signature,
          },
          signature: index.signature,
          surface: 'sidebar',
        },
        projectionScopeName,
      );
      if (projectionScopeName !== getCacheScope()) return;

      this.#set(
        {
          topicLoadMoreStateMap: {
            ...this.#get().topicLoadMoreStateMap,
            [key]: { isLoadingMore: false, loadMoreError: undefined },
          },
        },
        false,
        n('loadMoreTopics(success)'),
      );
    } catch (error) {
      this.#set(
        {
          topicLoadMoreStateMap: {
            ...this.#get().topicLoadMoreStateMap,
            [key]: {
              isLoadingMore: false,
              loadMoreError: error,
            },
          },
        },
        false,
        n('loadMoreTopics(error)'),
      );
    }
  };

  switchTopic = async (id?: string | null, options?: SwitchTopicOptions): Promise<void> => {
    const opts = options ?? {};
    const epoch = ++this.#switchTopicEpoch;

    const { activeAgentId, activeGroupId } = this.#get();

    // Clear the _new key data in the following cases:
    // 1. When id is null or undefined (switching to empty topic state)
    // 2. When clearNewKey option is explicitly true
    // This prevents stale data from previous conversations showing up
    // Note: Use == null to match both null and undefined
    const shouldClearNewKey = !id || opts.clearNewKey;

    if (shouldClearNewKey) {
      this.#get().clearPortalStack();
    }

    if (shouldClearNewKey && activeAgentId) {
      // Determine scope: use explicit scope from options, or infer from activeGroupId
      const scope = opts.scope ?? (activeGroupId ? 'group' : 'main');

      this.#get().replaceMessages([], {
        context: {
          agentId: activeAgentId,
          groupId: activeGroupId,
          scope,
          topicId: null,
        },
        action: n('clearNewKeyData'),
      });
    }

    this.#set(
      { activeTopicId: id || (null as any), activeThreadId: undefined },
      false,
      n('toggleTopic'),
    );

    if (activeAgentId) {
      this.#get().markTopicRead({ agentId: activeAgentId, topicId: id ?? null });
    }

    if (opts.skipRefreshMessage) return;

    // Yield a microtask so any switchTopic calls queued behind us can run
    // their sync bodies (and bump #switchTopicEpoch) before we commit to a
    // revalidation. On the other side of the yield, an epoch mismatch means a
    // newer switch has taken over — skip the redundant SWR mutate. Navigation
    // uses a soft ensure so a completed or in-flight sidebar prefetch is not
    // invalidated by the switch itself; explicit refresh signals still go
    // through refreshMessages and advance the request generation.
    await Promise.resolve();
    if (epoch !== this.#switchTopicEpoch) return;

    await this.#get().revalidateMessages();
  };

  removeSessionTopics = async (scope: TopicBatchDeleteScope = 'own'): Promise<void> => {
    const { switchTopic, activeAgentId, refreshTopic } = this.#get();
    if (!activeAgentId) return;
    const projectionScope = getCacheScope();
    const observedAt = nextProjectionObservedAt();
    const currentUserId = userProfileSelectors.userId(useUserStore.getState());
    const topics = getChatTopics(topicMapKey({ agentId: activeAgentId })) ?? [];
    const loadedTopicIds = topics
      .filter((topic) => scope !== 'own' || topic.userId === currentUserId)
      .map(({ id }) => id);
    const projectedTopicIds =
      scope === 'own' && !currentUserId
        ? []
        : selectChatTopicProjectionIds(getProjectionStoreState().scopes[projectionScope], {
            agentId: activeAgentId,
            ...(scope === 'own' ? { userId: currentUserId } : {}),
          });
    const topicIds = [...new Set([...loadedTopicIds, ...projectedTopicIds])];

    await topicService.removeTopicsByAgentId(activeAgentId, scope);
    getProjectionStoreState().deleteChatTopicProjections(projectionScope, topicIds, observedAt);
    await refreshTopic();
    // drop every deleted topic's message cache (all belong to this agent)
    void evictMessageCache((ctx) => ctx.agentId === activeAgentId);

    // switch to default topic
    switchTopic(null);
  };

  removeGroupTopics = async (
    groupId: string,
    scope: TopicBatchDeleteScope = 'own',
  ): Promise<void> => {
    const { switchTopic, refreshTopic } = this.#get();
    const projectionScope = getCacheScope();
    const observedAt = nextProjectionObservedAt();
    const currentUserId = userProfileSelectors.userId(useUserStore.getState());
    const topics = getChatTopics(topicMapKey({ groupId })) ?? [];
    const loadedTopicIds = topics
      .filter((topic) => scope !== 'own' || topic.userId === currentUserId)
      .map(({ id }) => id);
    const projectedTopicIds =
      scope === 'own' && !currentUserId
        ? []
        : selectChatTopicProjectionIds(getProjectionStoreState().scopes[projectionScope], {
            groupId,
            ...(scope === 'own' ? { userId: currentUserId } : {}),
          });
    const topicIds = [...new Set([...loadedTopicIds, ...projectedTopicIds])];

    await topicService.removeTopicsByGroupId(groupId, scope);
    getProjectionStoreState().deleteChatTopicProjections(projectionScope, topicIds, observedAt);
    await refreshTopic();
    // drop every deleted topic's message cache (all belong to this group)
    void evictMessageCache((ctx) => ctx.groupId === groupId);

    // switch to default topic
    switchTopic(null);
  };

  removeAllTopics = async (): Promise<void> => {
    const projectionScope = getCacheScope();
    const observedAt = nextProjectionObservedAt();
    const projectedTopicIds = selectChatTopicProjectionIds(
      getProjectionStoreState().scopes[projectionScope],
    );
    const topicIds = [...new Set(projectedTopicIds)];
    const { refreshTopic } = this.#get();

    await topicService.removeAllTopic();
    getProjectionStoreState().deleteChatTopicProjections(projectionScope, topicIds, observedAt);
    await refreshTopic();
    // every topic is gone — wipe all cached message lists
    void evictMessageCache(() => true);
  };

  removeTopic = async (id: string, removeFiles?: boolean): Promise<void> => {
    const projectionScope = getCacheScope();
    const observedAt = nextProjectionObservedAt();
    const { activeAgentId, activeGroupId, activeTopicId, switchTopic, refreshTopic } = this.#get();
    // Allow deletion when either agentId or groupId is active
    if (!activeAgentId && !activeGroupId) return;

    // remove topic (and optionally its uploaded attachments)
    await topicService.removeTopic(id, removeFiles);
    getProjectionStoreState().deleteChatTopicProjections(projectionScope, [id], observedAt);
    this.#get().internal_dispatchTopic({ type: 'deleteTopic', id }, 'removeTopic');
    await refreshTopic();
    // drop the deleted topic's message cache so it doesn't orphan in IndexedDB
    void evictMessageCache((ctx) => ctx.topicId === id);

    // switch back to default topic
    if (activeTopicId === id) switchTopic(null);
  };

  removeUnstarredTopic = async (options?: RemoveUnstarredTopicOptions): Promise<void> => {
    const projectionScope = getCacheScope();
    const observedAt = nextProjectionObservedAt();
    const { refreshTopic, switchTopic } = this.#get();
    const topics =
      topicsWithoutCron(getCurrentChatTopics())?.filter((topic) => !topic.favorite) ?? [];
    const currentUserId = userProfileSelectors.userId(useUserStore.getState());
    const topicIds = topics
      .filter((topic) => !options?.onlyOwn || (!!currentUserId && topic.userId === currentUserId))
      .map((topic) => topic.id);

    await topicService.batchRemoveTopics(topicIds);
    topicIds.forEach((id) =>
      this.#get().internal_dispatchTopic({ type: 'deleteTopic', id }, 'removeUnstarredTopic'),
    );
    getProjectionStoreState().deleteChatTopicProjections(projectionScope, topicIds, observedAt);
    await refreshTopic();
    // drop the deleted topics' message caches
    const removed = new Set(topicIds);
    void evictMessageCache((ctx) => !!ctx.topicId && removed.has(ctx.topicId));

    // Switch to default topic
    switchTopic(null);
  };

  batchMoveTopicsToAgent = async (topicIds: string[], targetAgentId: string): Promise<void> => {
    if (topicIds.length === 0) return;

    const { activeTopicId, switchTopic, refreshTopic } = this.#get();

    await topicService.batchMoveTopics(topicIds, targetAgentId);

    // Moved topics leave the current agent's list — drop them locally so the UI
    // updates immediately, then refetch to reconcile with the server.
    topicIds.forEach((id) =>
      this.#get().internal_dispatchTopic({ type: 'deleteTopic', id }, 'batchMoveTopicsToAgent'),
    );
    await refreshTopic();
    // the moved topics' message cache is keyed by the old agent — drop it so the
    // next view under the target agent refetches instead of reading a stale key
    const moved = new Set(topicIds);
    void evictMessageCache((ctx) => !!ctx.topicId && moved.has(ctx.topicId));

    // If the active topic was moved away, fall back to the default topic.
    if (activeTopicId && topicIds.includes(activeTopicId)) switchTopic(null);
  };

  internal_updateTopicTitleInSummary = (id: string, title: string): void => {
    this.#get().internal_dispatchTopic(
      { type: 'updateTopic', id, value: { title } },
      'updateTopicTitleInSummary',
    );
  };

  /**
   * @param ownerContainerKey - Revalidate this topic-list container instead of
   *   the active agent/group one. Pass it whenever the affected row may live
   *   elsewhere (Agent Builder panels render another agent's conversation);
   *   omitting it refreshes whatever the page is showing.
   */
  refreshTopic = async (ownerContainerKey?: string): Promise<void> => {
    const { activeAgentId, activeGroupId } = this.#get();
    // Use topicMapKey to generate the same key used in useFetchTopics
    // Key format: topicKeys.list(containerKey, { isInbox, pageSize })
    const containerKey =
      ownerContainerKey ?? topicMapKey({ agentId: activeAgentId, groupId: activeGroupId });
    const agentViewKey =
      ownerContainerKey ?? (activeAgentId ? topicMapKey({ agentId: activeAgentId }) : null);
    await mutate(
      (key) =>
        Array.isArray(key) &&
        ((key[0] === topicKeys.list.root &&
          typeof key[1] === 'string' &&
          key[1] === containerKey) ||
          (key[0] === topicKeys.agentView.root &&
            agentViewKey !== null &&
            key[1] === agentViewKey)),
    );
  };

  internal_replaceTopicId = (params: {
    agentId?: string;
    groupId?: string;
    nextId: string;
    previousId: string;
    value?: Partial<ChatTopic>;
  }): void => {
    const { agentId, groupId, nextId, previousId, value } = params;

    // The first-message optimistic topic starts as a client-only row. Once the
    // server returns the real id, keep the same row alive so title-summary
    // updates continue targeting the visible topic.
    this.#get().internal_dispatchTopic(
      {
        agentId,
        groupId,
        id: previousId,
        nextId,
        type: 'replaceTopicId',
        value,
      },
      n('replaceTopicId'),
    );

    if (previousId === nextId) return;

    this.#set(
      (state) => ({
        activeTopicId: state.activeTopicId === previousId ? nextId : state.activeTopicId,
      }),
      false,
      n('replaceTopicId/active'),
    );
  };

  internal_updateTopic = async (id: string, data: Partial<ChatTopic>): Promise<void> => {
    // The row is not necessarily in the active agent/group bucket — resolve the
    // one that holds it, so the optimistic write and the revalidation both land
    // where the topic is actually rendered (see `getTopicContainerKeyById`).
    const containerKey = getChatTopicContainerKeyById(id);

    this.#get().internal_dispatchTopic({ type: 'updateTopic', id, value: data, containerKey });

    await topicService.updateTopic(id, data);
    await this.#get().refreshTopic(containerKey);
  };

  internal_updateTopicLinkedPullRequest = async (
    params: TopicLinkedPullRequestRefreshParams,
    prData?: GitLinkedPRSummary,
  ): Promise<void> => {
    if (!isSuccessfulLinkedPullRequestLookup(prData)) return;

    const topic = getChatTopicById(params.topicId);
    if (!topic) return;

    const base = getTopicLinkedPullRequestBase(topic.metadata);
    if (
      !base ||
      base.branch !== params.branch ||
      base.path !== params.path ||
      base.pullRequestNumber !== params.pullRequestNumber
    ) {
      return;
    }

    const github = toWorkingDirGithubState(prData);
    if (!github) return;

    if (
      base.pullRequestNumber !== undefined &&
      github.pullRequest?.number !== base.pullRequestNumber
    ) {
      return;
    }

    const nextConfig = mergeWorkingDirGithubState({
      branch: base.branch,
      currentConfig: base.currentConfig,
      github,
      path: base.path,
      upstream: prData?.upstream,
    });

    if (isEqual(base.currentConfig, nextConfig)) return;

    this.#get().internal_dispatchTopic(
      {
        id: params.topicId,
        type: 'updateTopic',
        value: {
          metadata: {
            ...topic.metadata,
            workingDirectoryConfig: nextConfig,
          },
        },
      },
      n('refreshTopicLinkedPullRequest'),
    );

    try {
      await topicService.updateTopicMetadata(params.topicId, {
        workingDirectoryConfig: nextConfig,
      });
      await this.#get().refreshTopic();
    } catch (error) {
      await this.#get().refreshTopic();
      throw error;
    }
  };

  internal_createTopic = async (params: CreateTopicParams): Promise<string> => {
    const tmpId = Date.now().toString();
    this.#get().internal_dispatchTopic(
      { type: 'addTopic', value: { ...params, id: tmpId } },
      'internal_createTopic',
    );

    const topicId = await topicService.createTopic(params);
    await this.#get().refreshTopic();

    return topicId;
  };

  /**
   * Apply a topic mutation to the canonical Projection and its owning index.
   * Scope on the payload (`agentId`/`groupId`) wins; otherwise this falls back
   * to the currently active agent/group container. Pass scope when the write originates
   * outside the active UI context — e.g. an agent run finishing after the
   * user switched agents (see `updateTopicStatus`).
   */
  internal_dispatchTopic = (payload: ChatTopicDispatch, action?: any): void => {
    // Track the optimistic-row lifecycle here, at the single funnel every
    // add / replace / delete goes through, so a caller cannot register a
    // placeholder and then forget to clear it.
    if (payload.type === 'addTopic' && payload.optimistic && payload.value.id) {
      const id = payload.value.id;
      if (!this.#get().creatingTopicIds.includes(id)) {
        this.#set(
          (state) => ({ creatingTopicIds: [...state.creatingTopicIds, id] }),
          false,
          n('creatingTopic/register'),
        );
      }
    } else if (
      (payload.type === 'replaceTopicId' || payload.type === 'deleteTopic') && // The row is no longer client-only: either the server confirmed it, or
      // the send rolled back and the row is gone.
      this.#get().creatingTopicIds.includes(payload.id)
    ) {
      this.#set(
        (state) => ({
          creatingTopicIds: state.creatingTopicIds.filter((creating) => creating !== payload.id),
        }),
        false,
        n('creatingTopic/release'),
      );
    }

    const { activeAgentId, activeGroupId } = this.#get();
    const scopedAgentId = payload.scope ? payload.agentId : (payload.agentId ?? activeAgentId);
    const scopedGroupId = payload.scope ? payload.groupId : (payload.groupId ?? activeGroupId);
    const key =
      payload.containerKey ??
      (payload.type === 'addTopic' ? undefined : getChatTopicContainerKeyById(payload.id)) ??
      topicMapKey({
        agentId: scopedAgentId,
        groupId: scopedGroupId,
        scope: payload.scope,
      });
    const hasExplicitContext =
      payload.type === 'addTopic' ||
      payload.agentId !== undefined ||
      payload.groupId !== undefined ||
      payload.scope !== undefined;
    getProjectionStoreState().mutateChatTopicProjection(getCacheScope(), {
      containerKey: key,
      context: hasExplicitContext
        ? { agentId: scopedAgentId ?? null, groupId: scopedGroupId ?? null }
        : undefined,
      pageSize: useGlobalStore.getState().status.topicPageSize || 20,
      payload,
    });
    void action;
  };

  internal_updateTopics = (
    agentId: string | undefined,
    params: {
      append?: boolean;
      currentPage?: number;
      groupId?: string;
      items: ChatTopic[];
      pageSize: number;
      total: number;
    },
  ): void => {
    const { total, pageSize, currentPage = 0, append = false, groupId } = params;
    const key = topicMapKey({ agentId, groupId });
    const scope = getCacheScope();
    const existing = selectChatTopicsIndex(getProjectionStoreState().scopes[scope], 'sidebar', key);
    const items = params.items;

    getProjectionStoreState().commitChatTopicsPage(
      scope,
      {
        containerKey: key,
        context: { agentId: agentId ?? null, groupId: groupId ?? null },
        items,
        page: append ? currentPage : 0,
        pageSize,
        preserveIds: append ? undefined : this.#get().creatingTopicIds,
        signature: existing?.signature ?? {},
        surface: 'sidebar',
        total,
      },
      { observedAt: nextProjectionObservedAt(), source: 'network' },
    );
  };
}

export type ChatTopicAction = Pick<ChatTopicActionImpl, keyof ChatTopicActionImpl>;

// Note: To make the code more logic and readable, we just disable the auto sort key eslint rule
// DON'T REMOVE THE FIRST LINE
import { chainSummaryTitle } from '@lobechat/prompts';
import { type ChatTopicMetadata, type MessageMapScope, type UIChatMessage } from '@lobechat/types';
import { TraceNameMap } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { t } from 'i18next';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { message } from '@/components/AntdStaticMethods';
import { LOADING_FLAT } from '@/const/message';
import { mutate, useClientDataSWRWithSync } from '@/libs/swr';
import { cronKeys, deviceKeys, topicKeys } from '@/libs/swr/keys';
import { chatService } from '@/services/chat';
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
import {
  type ChatTopic,
  type ChatTopicStatus,
  type CreateTopicParams,
  type TopicQuerySortBy,
} from '@/types/topic';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

import { displayMessageSelectors } from '../message/selectors';
import { type TopicData } from './initialState';
import { type ChatTopicDispatch } from './reducer';
import { topicReducer } from './reducer';
import { topicSelectors } from './selectors';

const n = setNamespace('t');

const STALE_RUNNING_TOPIC_TIMEOUT = 2 * 60 * 60 * 1000;
const STALE_RUNNING_TOPIC_QUERY_PAGE_SIZE = 500;

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
    const sourceMetadata = metadata ?? topicSelectors.getTopicById(topicId)(this.#get())?.metadata;
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

    this.#get().internal_updateTopicLoading(topicId, true);
    // 2. auto summary topic Title
    // We don't need to await the summary, but this owner keeps the new topic
    // spinning immediately until the fire-and-forget title summary settles.
    void summaryTopicTitle(topicId, messages)
      .catch((error) => {
        console.error('[saveToTopic] Failed to summarize topic title:', error);
      })
      .finally(() => {
        this.#get().internal_updateTopicLoading(topicId, false);
      });

    return topicId;
  };

  duplicateTopic = async (id: string): Promise<void> => {
    const { refreshTopic, switchTopic } = this.#get();

    const topic = topicSelectors.getTopicById(id)(this.#get());
    if (!topic) return;

    const newTitle = t('duplicateTitle', { ns: 'chat', title: topic?.title });

    message.loading({
      content: t('duplicateLoading', { ns: 'topic' }),
      key: 'duplicateTopic',
      duration: 0,
    });

    const newTopicId = await topicService.cloneTopic(id, newTitle);
    await refreshTopic();
    message.destroy('duplicateTopic');
    message.success(t('duplicateSuccess', { ns: 'topic' }));

    await switchTopic(newTopicId);
  };

  importTopic = async (data: string): Promise<string | undefined> => {
    const { activeAgentId, activeGroupId, refreshTopic, switchTopic } = this.#get();

    if (!activeAgentId) return;

    message.loading({
      content: t('importLoading', { ns: 'topic' }),
      duration: 0,
      key: 'importTopic',
    });

    try {
      const result = await topicService.importTopic({
        agentId: activeAgentId,
        data,
        groupId: activeGroupId,
      });

      await refreshTopic();
      message.destroy('importTopic');
      message.success(t('importSuccess', { count: result.messageCount, ns: 'topic' }));

      await switchTopic(result.topicId);

      return result.topicId;
    } catch (error) {
      message.destroy('importTopic');
      message.error(t('importError', { ns: 'topic' }));
      console.error('[importTopic] Failed:', error);
      return undefined;
    }
  };

  summaryTopicTitle = async (topicId: string, messages: UIChatMessage[]): Promise<void> => {
    const { internal_updateTopicTitleInSummary, internal_updateTopicLoading } = this.#get();
    const topic = topicSelectors.getTopicById(topicId)(this.#get());
    if (!topic) return;

    // Keep an optimistic title like "阅读下面..." stable while AI rename runs;
    // otherwise the sidebar flickers `title -> ... -> final title`.
    const shouldStreamSummaryTitle = !topic.title || topic.title === LOADING_FLAT;

    if (shouldStreamSummaryTitle) internal_updateTopicTitleInSummary(topicId, LOADING_FLAT);

    let output = '';

    // Get current agent for topic
    const topicConfig = systemAgentSelectors.topic(useUserStore.getState());

    // Automatically summarize the topic title
    await chatService.fetchPresetTaskResult({
      onError: () => {
        if (shouldStreamSummaryTitle) internal_updateTopicTitleInSummary(topicId, topic.title);
      },
      onFinish: async (text) => {
        await this.#get().internal_updateTopic(topicId, { title: text });
      },
      onLoadingChange: (loading) => {
        internal_updateTopicLoading(topicId, loading);
      },
      onMessageHandle: (chunk) => {
        switch (chunk.type) {
          case 'text': {
            output += chunk.text;
          }
        }

        if (shouldStreamSummaryTitle) internal_updateTopicTitleInSummary(topicId, output);
      },
      params: merge(
        topicConfig,
        chainSummaryTitle(
          messages,
          userGeneralSettingsSelectors.currentResponseLanguage(useUserStore.getState()),
        ),
      ),
      trace: this.#get().getCurrentTracePayload({
        traceName: TraceNameMap.SummaryTopicTitle,
        topicId,
      }),
    });
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
    const topic = topicSelectors.getTopicById(id)(this.#get());
    if (!topic) return;

    // Optimistic update with merged metadata
    const mergedMetadata = { ...topic.metadata, ...metadata };
    this.#get().internal_dispatchTopic({
      type: 'updateTopic',
      id,
      value: { metadata: mergedMetadata },
    });

    this.#get().internal_updateTopicLoading(id, true);
    await topicService.updateTopicMetadata(id, metadata);
    await this.#get().refreshTopic();
    this.#get().internal_updateTopicLoading(id, false);
  };

  updateTopicTitle = async (id: string, title: string): Promise<void> => {
    await this.#get().internal_updateTopic(id, { title });
  };

  /**
   * Pin a model to a topic by writing the top-level `topics.model`/`provider`
   * columns (the config source of truth), NOT metadata. Called when the user
   * switches model while a topic is active so each topic keeps its own model
   * (see the Model/ModelLabel controls); generation + ChatInput display read it
   * back via `topicSelectors.getTopicModelById`.
   */
  updateTopicModel = async (
    id: string,
    { model, provider }: { model: string; provider: string },
  ): Promise<void> => {
    await this.#get().internal_updateTopic(id, { model, provider });
  };

  /**
   * Optimistic `updateTopicStatus` writes that a topic-list refetch must not
   * clobber. A refetch whose server query ran BEFORE a status write can land
   * AFTER the optimistic dispatch and revert the row — e.g. a run-end 'unread'
   * reverting to 'running', leaving the sidebar spinning forever on a finished
   * topic. Fetched rows are reconciled against this map: a row still carrying
   * the pre-write status gets the pending status re-applied; a row already
   * reflecting it confirms propagation and drops the pin. TTL-bounded so a
   * failed persist or a legit cross-device status change can't be suppressed
   * indefinitely.
   */
  #pendingTopicStatusWrites = new Map<string, { expiresAt: number; status: ChatTopicStatus }>();

  #reconcileFetchedTopics = (items: ChatTopic[], currentItems?: ChatTopic[]): ChatTopic[] => {
    let next = items;

    if (this.#pendingTopicStatusWrites.size > 0) {
      next = next.map((item) => {
        const pending = this.#pendingTopicStatusWrites.get(item.id);
        if (!pending) return item;
        if (pending.expiresAt <= Date.now() || item.status === pending.status) {
          this.#pendingTopicStatusWrites.delete(item.id);
          return item;
        }
        return { ...item, status: pending.status };
      });
    }

    // In-flight first-send optimistic rows (`tmp_topic_*`) are client-only, so
    // any refetch landing mid-send (e.g. the fire-and-forget refreshTopic after
    // a previous run's topic creation or terminal) would wipe them from the
    // sidebar until the server returns the real topicId. Re-prepend the ones
    // still in the bucket — they only ever leave it via replaceTopicId (send
    // resolved) or deleteTopic (rollback), never via a fetch.
    if (currentItems && currentItems.length > 0) {
      const optimisticRows = currentItems.filter((item) => item.id.startsWith('tmp_topic_'));
      if (optimisticRows.length > 0) {
        const fetchedIds = new Set(next.map((item) => item.id));
        const surviving = optimisticRows.filter((item) => !fetchedIds.has(item.id));
        if (surviving.length > 0) next = [...surviving, ...next];
      }
    }

    return next;
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
    const { topicId, status, agentId, groupId, scope } = params;
    const state = this.#get();
    const scopedAgentId = scope ? agentId : (agentId ?? state.activeAgentId);
    const scopedGroupId = scope ? groupId : (groupId ?? state.activeGroupId);
    const key = topicMapKey({
      agentId: scopedAgentId,
      groupId: scopedGroupId,
      scope,
    });
    const topic = state.topicDataMap[key]?.items?.find((t) => t.id === topicId);

    // Already at the target status — both the in-memory and DB writes are no-ops.
    if (topic?.status === status) return;

    // "Archive" in the UI writes status:'completed'. Stamp `completedAt` on that
    // transition so bulk/stale archive records when the topic was completed,
    // matching the single-item `markTopicCompleted`. Other status transitions
    // (agent runs → running/active/unread/…) leave `completedAt` untouched.
    const patch: Partial<ChatTopic> =
      status === 'completed' ? { completedAt: new Date(), status } : { status };

    this.#pendingTopicStatusWrites.set(topicId, { expiresAt: Date.now() + 15_000, status });

    // Scope on the payload routes the write to the owning bucket inside
    // `internal_dispatchTopic`. A no-op if the bucket isn't loaded; the DB
    // write below still ensures the status sticks across the next refetch.
    state.internal_dispatchTopic({
      type: 'updateTopic',
      id: topicId,
      value: patch,
      agentId,
      groupId,
      scope,
    });

    await topicService.updateTopic(topicId, patch).catch((err) => {
      console.error('[updateTopicStatus] persist failed:', err);
      // The DB never got the write — stop pinning it over fetched rows.
      this.#pendingTopicStatusWrites.delete(topicId);
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

    const key = topicMapKey(patchScope);
    const currentTopic = this.#get().topicDataMap[key]?.items.find((item) => item.id === topic.id);
    const metadata = currentTopic?.metadata ?? topic.metadata;

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
    const { activeAgentId: agentId, summaryTopicTitle, internal_updateTopicLoading } = this.#get();

    internal_updateTopicLoading(id, true);
    const messages = await messageService.getMessages({ agentId, topicId: id });

    await summaryTopicTitle(id, messages);
    internal_updateTopicLoading(id, false);
  };

  useFetchTopics = (
    enable: boolean,
    {
      agentId,
      excludeStatuses,
      excludeTriggers,
      groupId,
      pageSize: customPageSize,
      isInbox,
      sortBy,
      withDetails,
    }: {
      agentId?: string;
      excludeStatuses?: string[];
      excludeTriggers?: string[];
      groupId?: string;
      isInbox?: boolean;
      pageSize?: number;
      sortBy?: TopicQuerySortBy;
      withDetails?: boolean;
    } = {},
  ): SWRResponse<{ items: ChatTopic[]; total: number }> => {
    const pageSize = customPageSize || 20;
    const effectiveExcludeTriggers =
      excludeTriggers && excludeTriggers.length > 0 ? excludeTriggers : undefined;
    const effectiveExcludeStatuses =
      excludeStatuses && excludeStatuses.length > 0 ? excludeStatuses : undefined;
    // Use topicMapKey to generate the container key for topic data map
    const containerKey = topicMapKey({ agentId, groupId });
    const hasValidContainer = !!(groupId || agentId);

    return useClientDataSWRWithSync<{ items: ChatTopic[]; total: number }>(
      enable && hasValidContainer
        ? topicKeys.list(containerKey, {
            isInbox,
            pageSize,
            ...(effectiveExcludeTriggers ? { excludeTriggers: effectiveExcludeTriggers } : {}),
            ...(effectiveExcludeStatuses ? { excludeStatuses: effectiveExcludeStatuses } : {}),
            ...(sortBy ? { sortBy } : {}),
            ...(withDetails ? { withDetails: true } : {}),
          })
        : null,
      async () => {
        // agentId, groupId, isInbox, pageSize come from the outer scope closure
        if (!agentId && !groupId) return { items: [], total: 0 };

        const currentData = this.#get().topicDataMap[containerKey];
        const lastPageSize = currentData?.pageSize;
        const hasExistingItems = (currentData?.items?.length || 0) > 0;

        // Only treat as "expanding page size" when user actually increases pageSize,
        // not when SWR revalidates or when total items < pageSize.
        const isExpanding =
          hasExistingItems && typeof lastPageSize === 'number' && pageSize > lastPageSize;
        if (isExpanding) {
          this.#get().internal_updateTopicData(containerKey, { isExpandingPageSize: true });
        }

        const result = await topicService.getTopics({
          agentId,
          current: 0,
          excludeStatuses: effectiveExcludeStatuses,
          excludeTriggers: effectiveExcludeTriggers,
          groupId,
          isInbox,
          pageSize,
          sortBy,
          withDetails,
        });

        // Reset expanding state after fetch completes
        if (isExpanding) {
          this.#get().internal_updateTopicData(containerKey, { isExpandingPageSize: false });
        }

        return result;
      },
      {
        // onData: responsible for state updates (fires for both cached and fresh data)
        onData: (result) => {
          if (!hasValidContainer) return;

          const { total: totalCount } = result;

          const currentData = this.#get().topicDataMap[containerKey];
          const topics = this.#reconcileFetchedTopics(result.items, currentData?.items);

          const isRefreshingExpandedList =
            !!currentData &&
            currentData.currentPage > 0 &&
            currentData.pageSize === pageSize &&
            Boolean(currentData.isInbox) === Boolean(isInbox) &&
            isEqual(currentData.excludeStatuses, effectiveExcludeStatuses) &&
            isEqual(currentData.excludeTriggers, effectiveExcludeTriggers);

          const nextItems = isRefreshingExpandedList
            ? (() => {
                const visibleCount = Math.min(currentData.items.length, totalCount);
                const topicIds = new Set(topics.map((item) => item.id));

                return [
                  ...topics,
                  ...currentData.items.filter((topic) => !topicIds.has(topic.id)),
                ].slice(0, visibleCount);
              })()
            : topics;

          const hasMore = totalCount > nextItems.length;

          // no need to update map if the current key's data exists and is the same
          if (
            currentData &&
            isEqual(nextItems, currentData.items) &&
            currentData.total === totalCount &&
            isEqual(currentData.excludeStatuses, effectiveExcludeStatuses) &&
            isEqual(currentData.excludeTriggers, effectiveExcludeTriggers)
          ) {
            return;
          }

          this.#set(
            {
              topicDataMap: {
                ...this.#get().topicDataMap,
                [containerKey]: {
                  currentPage: isRefreshingExpandedList ? currentData.currentPage : 0,
                  excludeStatuses: effectiveExcludeStatuses,
                  excludeTriggers: effectiveExcludeTriggers,
                  hasMore,
                  isInbox: Boolean(isInbox),
                  isExpandingPageSize: false,
                  isLoadingMore: false,
                  loadMoreError: undefined,
                  items: nextItems,
                  pageSize,
                  total: totalCount,
                  withDetails,
                },
              },
            },
            false,
            n('useFetchTopics(onData)', { containerKey }),
          );
        },
      },
    );
  };

  /**
   * Topic fetch dedicated to the Agent Topics management page.
   * Lives in its own SWR key + state bucket so the heavier `withDetails`
   * payload doesn't collide with the sidebar's cheap fetch — sharing one
   * bucket meant whichever response landed last clobbered the other.
   */
  useFetchAgentTopicsView = (
    enable: boolean,
    {
      agentId,
      pageSize: customPageSize,
      withDetails,
    }: {
      agentId?: string;
      pageSize?: number;
      withDetails?: boolean;
    } = {},
  ): SWRResponse<{ items: ChatTopic[]; total: number }> => {
    const pageSize = customPageSize || 30;
    const containerKey = topicMapKey({ agentId });
    const hasValidAgent = !!agentId;

    return useClientDataSWRWithSync<{ items: ChatTopic[]; total: number }>(
      enable && hasValidAgent
        ? topicKeys.agentView(containerKey, {
            pageSize,
            ...(withDetails ? { withDetails: true } : {}),
          })
        : null,
      async () => {
        if (!agentId) return { items: [], total: 0 };

        return topicService.getTopics({
          agentId,
          current: 0,
          pageSize,
          withDetails,
        });
      },
      {
        onData: (result) => {
          if (!hasValidAgent) return;
          const { total: totalCount } = result;

          const currentData = this.#get().agentTopicsViewMap[containerKey];
          const topics = this.#reconcileFetchedTopics(result.items, currentData?.items);

          // Preserve appended pages on refresh — same convention as
          // `useFetchTopics` so the user keeps their scroll position after
          // an SWR revalidation.
          const isRefreshingExpandedList =
            !!currentData && currentData.currentPage > 0 && currentData.pageSize === pageSize;

          const nextItems = isRefreshingExpandedList
            ? (() => {
                const visibleCount = Math.min(currentData.items.length, totalCount);
                const topicIds = new Set(topics.map((item) => item.id));
                return [
                  ...topics,
                  ...currentData.items.filter((topic) => !topicIds.has(topic.id)),
                ].slice(0, visibleCount);
              })()
            : topics;

          const hasMore = totalCount > nextItems.length;

          if (
            currentData &&
            isEqual(nextItems, currentData.items) &&
            currentData.total === totalCount
          ) {
            return;
          }

          this.#set(
            {
              agentTopicsViewMap: {
                ...this.#get().agentTopicsViewMap,
                [containerKey]: {
                  currentPage: isRefreshingExpandedList ? currentData.currentPage : 0,
                  hasMore,
                  isExpandingPageSize: false,
                  isLoadingMore: false,
                  loadMoreError: undefined,
                  items: nextItems,
                  pageSize,
                  total: totalCount,
                  withDetails,
                },
              },
            },
            false,
            n('useFetchAgentTopicsView(onData)', { containerKey }),
          );
        },
      },
    );
  };

  loadMoreAgentTopicsView = async (): Promise<void> => {
    const { activeAgentId, agentTopicsViewMap } = this.#get();
    if (!activeAgentId) return;

    const key = topicMapKey({ agentId: activeAgentId });
    const currentData = agentTopicsViewMap[key];
    if (!currentData || currentData.isLoadingMore) return;

    const nextPage = (currentData.currentPage || 0) + 1;
    const pageSize = currentData.pageSize;
    const withDetails = currentData.withDetails;

    this.#set(
      {
        agentTopicsViewMap: {
          ...agentTopicsViewMap,
          [key]: { ...currentData, isLoadingMore: true, loadMoreError: undefined },
        },
      },
      false,
      n('loadMoreAgentTopicsView(start)'),
    );

    try {
      const result = await topicService.getTopics({
        agentId: activeAgentId,
        current: nextPage,
        pageSize,
        withDetails,
      });

      const nextItems = [...currentData.items, ...result.items];
      const hasMore = result.total > nextItems.length;

      this.#set(
        {
          agentTopicsViewMap: {
            ...this.#get().agentTopicsViewMap,
            [key]: {
              ...currentData,
              currentPage: nextPage,
              hasMore,
              isLoadingMore: false,
              loadMoreError: undefined,
              items: nextItems,
              total: result.total,
            },
          },
        },
        false,
        n('loadMoreAgentTopicsView(success)'),
      );
    } catch (error) {
      this.#set(
        {
          agentTopicsViewMap: {
            ...this.#get().agentTopicsViewMap,
            [key]: {
              ...this.#get().agentTopicsViewMap[key]!,
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
    const { activeAgentId, activeGroupId, topicDataMap } = this.#get();
    const key = topicMapKey({ agentId: activeAgentId, groupId: activeGroupId });
    const currentData = topicDataMap[key];

    if ((!activeAgentId && !activeGroupId) || currentData?.isLoadingMore) return;

    const currentPage = currentData?.currentPage || 0;
    const nextPage = currentPage + 1;

    this.#set(
      {
        topicDataMap: {
          ...topicDataMap,
          [key]: { ...currentData!, isLoadingMore: true, loadMoreError: undefined },
        },
      },
      false,
      n('loadMoreTopics(start)'),
    );

    try {
      const pageSize = useGlobalStore.getState().status.topicPageSize || 20;
      const excludeTriggers = currentData?.excludeTriggers;
      const excludeStatuses = currentData?.excludeStatuses;
      // Carry `withDetails` from the initial fetch so subsequent pages have
      // the same column shape — otherwise the management page would mix
      // detail-rich rows with bare rows after scrolling.
      const withDetails = currentData?.withDetails;
      const result = await topicService.getTopics({
        agentId: activeAgentId,
        current: nextPage,
        excludeStatuses,
        excludeTriggers,
        groupId: activeGroupId,
        pageSize,
        withDetails,
      });

      const currentTopics = currentData?.items || [];
      const nextItems = [...currentTopics, ...result.items];
      const hasMore = result.total > nextItems.length;

      this.#set(
        {
          topicDataMap: {
            ...this.#get().topicDataMap,
            [key]: {
              currentPage: nextPage,
              excludeStatuses,
              excludeTriggers,
              hasMore,
              isInbox: currentData?.isInbox,
              isLoadingMore: false,
              loadMoreError: undefined,
              items: nextItems,
              pageSize,
              total: result.total,
              withDetails,
            },
          },
        },
        false,
        n('loadMoreTopics(success)'),
      );
    } catch (error) {
      this.#set(
        {
          topicDataMap: {
            ...this.#get().topicDataMap,
            [key]: {
              ...this.#get().topicDataMap[key]!,
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

  useSearchTopics = (
    keywords: string | undefined,
    {
      agentId,
      groupId,
    }: {
      agentId?: string;
      groupId?: string;
    } = {},
  ): SWRResponse<ChatTopic[]> => {
    return useSWR<ChatTopic[]>(
      keywords ? topicKeys.search(keywords, agentId, groupId) : null,
      ([, keywords, agentId, groupId]: [string, string, string | undefined, string | undefined]) =>
        topicService.searchTopics(keywords, agentId, groupId),
      {
        onSuccess: (data) => {
          // Search rows render the same status icon as the sidebar — pin
          // pending status writes here too (no tmp-row re-prepend: optimistic
          // rows don't belong in search results).
          this.#set(
            { searchTopics: this.#reconcileFetchedTopics(data), isSearchingTopic: false },
            false,
            n('useSearchTopics(success)', { keywords }),
          );
        },
      },
    );
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

    await topicService.removeTopicsByAgentId(activeAgentId, scope);
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

    await topicService.removeTopicsByGroupId(groupId, scope);
    await refreshTopic();
    // drop every deleted topic's message cache (all belong to this group)
    void evictMessageCache((ctx) => ctx.groupId === groupId);

    // switch to default topic
    switchTopic(null);
  };

  removeAllTopics = async (): Promise<void> => {
    const { refreshTopic } = this.#get();

    await topicService.removeAllTopic();
    await refreshTopic();
    // every topic is gone — wipe all cached message lists
    void evictMessageCache(() => true);
  };

  removeTopic = async (id: string, removeFiles?: boolean): Promise<void> => {
    const { activeAgentId, activeGroupId, activeTopicId, switchTopic, refreshTopic } = this.#get();
    // Allow deletion when either agentId or groupId is active
    if (!activeAgentId && !activeGroupId) return;

    // remove topic (and optionally its uploaded attachments)
    await topicService.removeTopic(id, removeFiles);
    this.#get().internal_dispatchTopic({ type: 'deleteTopic', id }, 'removeTopic');
    await refreshTopic();
    // drop the deleted topic's message cache so it doesn't orphan in IndexedDB
    void evictMessageCache((ctx) => ctx.topicId === id);

    // switch back to default topic
    if (activeTopicId === id) switchTopic(null);
  };

  removeUnstarredTopic = async (options?: RemoveUnstarredTopicOptions): Promise<void> => {
    const { refreshTopic, switchTopic } = this.#get();
    const topics = topicSelectors.currentUnFavTopics(this.#get());
    const currentUserId = userProfileSelectors.userId(useUserStore.getState());
    const topicIds = topics
      .filter((topic) => !options?.onlyOwn || (!!currentUserId && topic.userId === currentUserId))
      .map((topic) => topic.id);

    await topicService.batchRemoveTopics(topicIds);
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

  refreshTopic = async (): Promise<void> => {
    const { activeAgentId, activeGroupId } = this.#get();
    // Use topicMapKey to generate the same key used in useFetchTopics
    // Key format: topicKeys.list(containerKey, { isInbox, pageSize })
    const containerKey = topicMapKey({ agentId: activeAgentId, groupId: activeGroupId });
    const agentViewKey = activeAgentId ? topicMapKey({ agentId: activeAgentId }) : null;
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

  internal_updateTopicLoading = (id: string, loading: boolean): void => {
    this.#set(
      (state) => {
        const currentCount =
          state.topicLoadingIdCounts[id] ?? (state.topicLoadingIds.includes(id) ? 1 : 0);
        const nextCounts = { ...state.topicLoadingIdCounts };

        if (loading) {
          nextCounts[id] = currentCount + 1;
          const nextIds = state.topicLoadingIds.includes(id)
            ? state.topicLoadingIds
            : [...state.topicLoadingIds, id];

          return {
            topicLoadingIdCounts: nextCounts,
            topicLoadingIds: nextIds,
          };
        }

        if (currentCount > 1) {
          nextCounts[id] = currentCount - 1;

          return { topicLoadingIdCounts: nextCounts, topicLoadingIds: state.topicLoadingIds };
        }

        delete nextCounts[id];
        const nextIds = state.topicLoadingIds.filter((i) => i !== id);

        return {
          topicLoadingIdCounts: nextCounts,
          topicLoadingIds: nextIds,
        };
      },
      false,
      n('updateTopicLoading'),
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

    // The first-message optimistic topic starts as `tmp_topic_*`. Once the
    // server returns the real id, keep the same row alive so loading state and
    // title-summary updates continue targeting the visible topic.
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

    this.#set(
      (state) => {
        const previousCount = state.topicLoadingIdCounts[previousId] ?? 0;
        const nextCount = state.topicLoadingIdCounts[nextId] ?? 0;
        const topicLoadingIdCounts = { ...state.topicLoadingIdCounts };
        delete topicLoadingIdCounts[previousId];
        if (previousCount > 0 || nextCount > 0) {
          topicLoadingIdCounts[nextId] = previousCount + nextCount;
        }
        const topicLoadingIds = Array.from(
          new Set(state.topicLoadingIds.map((id) => (id === previousId ? nextId : id))),
        );

        return {
          activeTopicId: state.activeTopicId === previousId ? nextId : state.activeTopicId,
          topicLoadingIdCounts,
          topicLoadingIds,
        };
      },
      false,
      n('replaceTopicId/loading'),
    );
  };

  internal_updateTopic = async (id: string, data: Partial<ChatTopic>): Promise<void> => {
    this.#get().internal_dispatchTopic({ type: 'updateTopic', id, value: data });

    this.#get().internal_updateTopicLoading(id, true);
    try {
      await topicService.updateTopic(id, data);
      await this.#get().refreshTopic();
    } finally {
      // Rename "Topic" -> "New" can fail after opening a loading owner; always release it.
      this.#get().internal_updateTopicLoading(id, false);
    }
  };

  internal_updateTopicLinkedPullRequest = async (
    params: TopicLinkedPullRequestRefreshParams,
    prData?: GitLinkedPRSummary,
  ): Promise<void> => {
    if (!isSuccessfulLinkedPullRequestLookup(prData)) return;

    const topic = topicSelectors.getTopicById(params.topicId)(this.#get());
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

    this.#get().internal_updateTopicLoading(tmpId, true);
    const topicId = await topicService.createTopic(params);
    this.#get().internal_updateTopicLoading(tmpId, false);

    this.#get().internal_updateTopicLoading(topicId, true);
    await this.#get().refreshTopic();
    this.#get().internal_updateTopicLoading(topicId, false);

    return topicId;
  };

  /**
   * Apply a topic reducer to a bucket in `topicDataMap`. Scope on the payload
   * (`agentId`/`groupId`) wins; otherwise falls back to the currently active
   * agent/group bucket. Pass scope on the payload when the write originates
   * outside the active UI context — e.g. an agent run finishing after the
   * user switched agents (see `updateTopicStatus`).
   */
  internal_dispatchTopic = (payload: ChatTopicDispatch, action?: any): void => {
    const { activeAgentId, activeGroupId } = this.#get();
    const scopedAgentId = payload.scope ? payload.agentId : (payload.agentId ?? activeAgentId);
    const scopedGroupId = payload.scope ? payload.groupId : (payload.groupId ?? activeGroupId);
    const key = topicMapKey({
      agentId: scopedAgentId,
      groupId: scopedGroupId,
      scope: payload.scope,
    });
    const currentData = this.#get().topicDataMap[key];
    const nextItems = topicReducer(currentData?.items, payload);

    // Mirror the optimistic update into the Agent Topics management page's
    // bucket if it has been populated for the same key. Without this mirror,
    // bulk actions (favorite/status/delete) on the management page would
    // appear to do nothing until the SWR revalidation finished.
    const viewMap = this.#get().agentTopicsViewMap;
    const viewData = viewMap[key];
    const nextViewItems = viewData ? topicReducer(viewData.items, payload) : undefined;
    const viewChanged = viewData ? !isEqual(nextViewItems, viewData.items) : false;

    // no need to update if both maps are unchanged
    const mainChanged = !isEqual(nextItems, currentData?.items);
    if (!mainChanged && !viewChanged) return;

    const currentTotal = currentData?.total ?? currentData?.items?.length ?? 0;
    const total =
      payload.type === 'addTopic'
        ? currentTotal + 1
        : payload.type === 'deleteTopic'
          ? Math.max(nextItems.length, currentTotal - 1)
          : currentTotal;

    const nextState: Record<string, unknown> = {};

    if (mainChanged) {
      nextState.topicDataMap = {
        ...this.#get().topicDataMap,
        [key]: {
          ...currentData,
          currentPage: currentData?.currentPage ?? 0,
          hasMore: total > nextItems.length,
          isInbox: currentData?.isInbox,
          items: nextItems,
          total,
        },
      };
    }

    if (viewChanged && viewData && nextViewItems) {
      const viewTotal = viewData.total ?? viewData.items?.length ?? 0;
      const viewNextTotal =
        payload.type === 'addTopic'
          ? viewTotal + 1
          : payload.type === 'deleteTopic'
            ? Math.max(nextViewItems.length, viewTotal - 1)
            : viewTotal;
      nextState.agentTopicsViewMap = {
        ...viewMap,
        [key]: {
          ...viewData,
          hasMore: viewNextTotal > nextViewItems.length,
          items: nextViewItems,
          total: viewNextTotal,
        },
      };
    }

    this.#set(nextState, false, action ?? n(`dispatchTopic/${payload.type}`));
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
    const currentData = this.#get().topicDataMap[key];
    // Append mode keeps the existing items (optimistic rows included) in front,
    // so only pass them for reconciliation on full replacement.
    const items = this.#reconcileFetchedTopics(
      params.items,
      append ? undefined : currentData?.items,
    );

    const nextItems = append ? [...(currentData?.items || []), ...items] : items;

    this.#set(
      {
        topicDataMap: {
          ...this.#get().topicDataMap,
          [key]: {
            currentPage,
            excludeStatuses: currentData?.excludeStatuses,
            excludeTriggers: currentData?.excludeTriggers,
            hasMore: total > nextItems.length,
            isInbox: currentData?.isInbox,
            isExpandingPageSize: false,
            isLoadingMore: false,
            items: nextItems,
            pageSize,
            total,
          },
        },
      },
      false,
      n('internal_updateTopics', { key, append }),
    );
  };

  internal_updateTopicData = (key: string, data: Partial<TopicData>): void => {
    const currentData = this.#get().topicDataMap[key];
    if (!currentData) return;

    this.#set(
      {
        topicDataMap: {
          ...this.#get().topicDataMap,
          [key]: {
            ...currentData,
            ...data,
          },
        },
      },
      false,
      n('internal_updateTopicData', { key, data }),
    );
  };
}

export type ChatTopicAction = Pick<ChatTopicActionImpl, keyof ChatTopicActionImpl>;

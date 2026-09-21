// Note: To make the code more logic and readable, we just disable the auto sort key eslint rule
// DON'T REMOVE THE FIRST LINE
import { TRACING_SCENARIOS } from '@lobechat/const';
import {
  chainSummaryTitle,
  TOPIC_TITLE_JSON_SCHEMA,
  TOPIC_TITLE_PROMPT_VERSION,
} from '@lobechat/prompts';
import {
  type ChatTopicMetadata,
  type HeterogeneousReasoningEffort,
  type MessageMapScope,
  RequestTrigger,
  type UIChatMessage,
  type UpdateTopicMetadataInput,
} from '@lobechat/types';
import { toast } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { t } from 'i18next';
import type { AiModelReasoningConfig } from 'model-bank';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { LOADING_FLAT } from '@/const/message';
import {
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  type ReplicaPageResult,
  type ReplicaSyncResult,
  singleEntity,
} from '@/libs/replica';
import { mutate, useClientDataSWRWithSync } from '@/libs/swr';
import { cronKeys, deviceKeys, topicKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { aiChatService } from '@/services/aiChat';
import { type GitLinkedPRSummary, gitService } from '@/services/git';
import { messageService } from '@/services/message';
import type { TopicBatchDeleteScope } from '@/services/topic';
import { topicService } from '@/services/topic';
import { getAiInfraStoreState } from '@/store/aiInfra';
import { aiModelSelectors } from '@/store/aiInfra/slices/aiModel/selectors';
import { type ChatStore } from '@/store/chat';
import { evictMessageCache } from '@/store/chat/utils/evictMessageCache';
import { snapshotAgentModel, snapshotAgentReasoning } from '@/store/chat/utils/snapshotAgentModel';
import { topicMapKey, type TopicMapScope } from '@/store/chat/utils/topicMapKey';
import {
  isAudioOnlyFirstUserMessage,
  normalizeTopicTitleMessages,
} from '@/store/chat/utils/topicTitle';
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
import { type TopicData } from './initialState';
import {
  applyTopicDispatchToBucket,
  normalizeTopicListParams,
  type TopicAgentViewParams,
  topicAgentViewResource,
  topicDetailResource,
  type TopicListParams,
  topicListResource,
} from './projection';
import { type ChatTopicDispatch } from './reducer';
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

/**
 * Entity patch shared by every topic resource: merge, and bump `updatedAt`
 * only on a real change (same reference otherwise, so nothing re-renders).
 */
const patchTopic =
  (value: Partial<ChatTopic>) =>
  (topic: ChatTopic): ChatTopic => {
    const merged = { ...topic, ...value };
    // TODO: updatedAt type needs to be changed to Date later
    return isEqual(topic, merged) ? topic : ({ ...merged, updatedAt: new Date() } as any);
  };

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

type PendingTopicStatusSource = 'cache' | 'server';

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
   * The conversation whose `_new` bucket the cleanup should target. Send
   * flows pass the conversation the send started from: when the navigation
   * guard drops the switch, the user may be viewing a different agent/group,
   * and cleaning up by current view would wipe that view's blank bucket
   * instead of the send's own. Omit to clean by the current view (legacy).
   */
  clearNewKeyContext?: {
    agentId: string;
    groupId?: string | null;
    scope?: MessageMapScope;
  };
  /**
   * Only apply the switch while the active agent still matches. Send flows
   * pin the agent they started from: the topic guard cannot tell two blank
   * views apart (both have `activeTopicId === null`), so without this a send
   * from agent A's blank view would adopt its minted topic while the user is
   * on agent B's blank view. Omit the option to skip the check.
   */
  onlyIfActiveAgentId?: string | null;
  /**
   * Only apply the switch while the active group still matches — the
   * group-scope counterpart of `onlyIfActiveAgentId`.
   */
  onlyIfActiveGroupId?: string | null;
  /**
   * Only apply the switch while the user is still on one of these conversation
   * buckets. Send flows pass every bucket their conversation can currently live
   * under — the client-minted topic id before the server confirms it, the
   * persisted id after the re-key — so a continuation whose await the user
   * navigated away from skips the switch instead of yanking the UI (and the
   * URL) back to the sent topic. Include `null` to allow the blank
   * new-conversation view. Omit the option to always apply the switch.
   */
  onlyIfActiveTopicIn?: ReadonlyArray<string | null>;
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

  #summarizingTopicTitleIds = new Set<string>();

  /**
   * Three local-first resources over the same entity, each owning ONE store
   * location (selectors keep reading those maps):
   * - `#topicList`: sidebar pages → `topicDataMap[containerKey]`
   * - `#topicAgentView`: management page (`withDetails`, larger pages) →
   *   `agentTopicsViewMap[containerKey]`
   * - `#topicDetail`: by-id fallback → `topicDetailMap[topicId]`
   * `#topicEntity` fans a topic-level change (patch / delete / optimistic
   * write) out to whichever of them currently hold that topic.
   */
  readonly #topicList;
  readonly #topicAgentView;
  readonly #topicDetail;
  readonly #topicEntity;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    // In-flight first-send rows: kept across refetches, never persisted.
    const isClientOnly = (topic: ChatTopic) => get().creatingTopicIds.includes(topic.id);
    // The page-size expansion flag is transient UI state.
    const toPersisted = ({ isExpandingPageSize: _expanding, ...data }: TopicData) => data;

    this.#topicList = createReplicaSlice(topicListResource, {
      actionPrefix: n('topicList'),
      fetcher: this.#fetchTopicListPage,
      get,
      isClientOnly,
      set,
      stateKey: 'topicListReplica',
      toPersisted,
      view: recordLens<ChatStore, TopicData>('topicDataMap'),
      viewFields: ({ excludeStatuses, excludeTriggers, isInbox, sortBy, withDetails }) => ({
        excludeStatuses,
        excludeTriggers,
        isInbox: Boolean(isInbox),
        sortBy,
        withDetails,
      }),
    });
    this.#topicAgentView = createReplicaSlice(topicAgentViewResource, {
      actionPrefix: n('topicAgentView'),
      fetcher: this.#fetchAgentViewPage,
      get,
      isClientOnly,
      set,
      stateKey: 'agentTopicsViewReplica',
      toPersisted,
      view: recordLens<ChatStore, TopicData>('agentTopicsViewMap'),
      viewFields: ({ withDetails }) => ({ withDetails }),
    });
    this.#topicDetail = createReplicaSlice(topicDetailResource, {
      actionPrefix: n('topicDetail'),
      entity: singleEntity<ChatTopic>((topic) => topic.id),
      fetcher: (topicId) => topicService.getTopicDetail(topicId),
      get,
      // A missing topic keeps whatever is cached (the list may still hold it).
      merge: (topic, confirmed) => (!topic || isEqual(topic, confirmed) ? undefined : topic),
      set,
      stateKey: 'topicDetailReplica',
      view: recordLens<ChatStore, ChatTopic>('topicDetailMap'),
    });
    this.#topicEntity = linkReplicaEntity<ChatTopic>([
      this.#topicList,
      this.#topicAgentView,
      this.#topicDetail,
    ]);
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
    const modelSnapshot = snapshotAgentModel(targetSessionId);
    const reasoningSnapshot = await snapshotAgentReasoning(targetSessionId, modelSnapshot);
    const topicId = await internal_createTopic({
      ...modelSnapshot,
      ...(reasoningSnapshot ? { metadata: reasoningSnapshot } : {}),
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
    const modelSnapshot = snapshotAgentModel(targetSessionId);
    const reasoningSnapshot = await snapshotAgentReasoning(targetSessionId, modelSnapshot);
    const topicId = await internal_createTopic({
      ...modelSnapshot,
      ...(reasoningSnapshot ? { metadata: reasoningSnapshot } : {}),
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

    const topic = topicSelectors.getTopicById(id)(this.#get());
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
    const topic =
      topicSelectors.getTopicById(topicId)(this.#get()) ??
      (await topicService.getTopicDetail(topicId));
    if (!topic) return;

    const messagesForTitle = normalizeTopicTitleMessages(messages);

    // A voice-only first message has no text until the assistant responds. Do not
    // replace the visible default title with a loading placeholder for an empty
    // summary request; the run lifecycle retries with the completed reply.
    const hasTextContent = messagesForTitle.some((message) => {
      const content = message.content?.trim();
      return !!content && !(message.role === 'assistant' && content === LOADING_FLAT);
    });
    if (!hasTextContent && isAudioOnlyFirstUserMessage(messagesForTitle)) return;
    if (this.#summarizingTopicTitleIds.has(topicId)) return;

    this.#summarizingTopicTitleIds.add(topicId);

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
            messagesForTitle,
            userGeneralSettingsSelectors.currentResponseLanguage(useUserStore.getState()),
          ),
          metadata: { topicId, trigger: RequestTrigger.TopicTitle },
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
    } finally {
      this.#summarizingTopicTitleIds.delete(topicId);
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

  updateTopicMetadata = async (
    id: string,
    metadata: UpdateTopicMetadataInput & Pick<ChatTopicMetadata, 'onboardingSession'>,
  ): Promise<void> => {
    const topic = topicSelectors.getTopicById(id)(this.#get());
    if (!topic) {
      await topicService.updateTopicMetadata(id, metadata);
      await this.#get()
        .refreshTopic()
        .catch(() => undefined);
      return;
    }

    // Optimistic update with merged metadata
    const mergedMetadata = { ...topic.metadata, ...metadata };
    this.#get().internal_dispatchTopic({
      type: 'updateTopic',
      id,
      value: { metadata: mergedMetadata },
    });

    try {
      await topicService.updateTopicMetadata(id, metadata);
    } catch (error) {
      this.#get().internal_dispatchTopic({
        type: 'updateTopic',
        id,
        value: { metadata: topic.metadata },
      });
      throw error;
    }
    await this.#get()
      .refreshTopic()
      .catch(() => undefined);
  };

  updateTopicTitle = async (id: string, title: string): Promise<void> => {
    await this.#get().internal_updateTopic(id, { title });
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
    await this.#enqueueTopicEffortWrite(id, async () => {
      // The effort pin belongs to the model it was taken for (the param names
      // are model-specific), so switching model re-snapshots it from the user's
      // config for the new model — same "remembers what it started with" rule.
      const reasoningConfig = await this.#get().internal_resolveTopicReasoningSnapshot({
        model,
        provider,
      });
      await this.#writeTopicModelPin(id, {
        metadata: reasoningConfig ? { reasoningConfig } : undefined,
        model,
        provider,
      });
    });
  };

  /**
   * Model + pin land in one server write (`topic.updateTopicModel`) so a run or
   * a concurrent switch can never see the new model with the old model's pin.
   * Optimistically mirrors the server merge: `reasoningConfig` is replaced,
   * `heteroEffort` only when given.
   */
  #writeTopicModelPin = async (
    id: string,
    value: {
      metadata?: Pick<ChatTopicMetadata, 'heteroEffort' | 'reasoningConfig'>;
      model: string;
      provider: string;
    },
  ): Promise<void> => {
    const { activeAgentId, activeGroupId } = this.#get();
    const containerKey =
      topicSelectors.getTopicContainerKeyById(id)(this.#get()) ??
      topicMapKey({ agentId: activeAgentId, groupId: activeGroupId });
    const previous = topicSelectors.getTopicById(id)(this.#get());
    const { reasoningConfig: _stale, ...rest } = previous?.metadata ?? {};
    this.#get().internal_dispatchTopic({
      containerKey,
      id,
      type: 'updateTopic',
      value: {
        metadata: { ...rest, ...value.metadata },
        model: value.model,
        provider: value.provider,
      },
    });

    try {
      await topicService.updateTopicModel(id, value);
    } catch (error) {
      if (previous) {
        this.#get().internal_dispatchTopic({
          containerKey,
          id,
          type: 'updateTopic',
          value: {
            model: previous.model,
            provider: previous.provider,
            metadata: previous.metadata,
          },
        });
      }
      await this.#recoverTopicPinWrite(containerKey, error);
    }
    await this.#get().refreshTopic(containerKey);
  };

  /**
   * Resolve the user-level reasoning config to pin for `model`, fetching it when
   * not cached yet. Returns `undefined` for models without reasoning extend
   * params (nothing to pin).
   */
  internal_resolveTopicReasoningSnapshot = async ({
    model,
    provider,
  }: {
    model: string;
    provider: string;
  }): Promise<AiModelReasoningConfig | undefined> => {
    const aiInfraStore = getAiInfraStoreState();
    if (!aiModelSelectors.isModelHasReasoningExtendParams(model, provider)(aiInfraStore)) return;

    await aiInfraStore.ensureModelReasoningConfig(model, provider);
    return aiModelSelectors.modelReasoningConfig(model, provider)(getAiInfraStoreState()) ?? {};
  };

  /**
   * Change the reasoning effort / mode of one topic without touching the
   * user-level model-instance config. The patch is merged over the topic's
   * current pin (seeded with `base` — normally the user-level config — when the
   * topic has no pin yet), so a topic that only ever changed its effort still
   * keeps the user's reasoning mode.
   */
  updateTopicReasoningConfig = async (
    id: string,
    patch: AiModelReasoningConfig,
    base?: AiModelReasoningConfig,
  ): Promise<void> => {
    await this.#enqueueTopicEffortWrite(id, async () => {
      const current = topicSelectors.getTopicById(id)(this.#get())?.metadata?.reasoningConfig;
      await this.#writeTopicEffortPin(id, {
        reasoningConfig: { ...(current ?? base), ...patch },
      });
    });
  };

  /** Pin a heterogeneous agent's reasoning effort to one topic (`metadata.heteroEffort`). */
  updateTopicHeteroEffort = async (
    id: string,
    effort: HeterogeneousReasoningEffort,
  ): Promise<void> => {
    await this.#enqueueTopicEffortWrite(id, () =>
      this.#writeTopicEffortPin(id, { heteroEffort: effort }),
    );
  };

  /**
   * Apply a heterogeneous (Claude Code / Codex) model + effort selection to one
   * topic. When the selector pairs a model switch with an effort reset (the new
   * model does not support the current effort) both land in the same write, so
   * the topic never carries a model with an effort it cannot run.
   */
  updateTopicHeteroPin = async (
    id: string,
    {
      effort,
      model,
      provider,
    }: { effort?: HeterogeneousReasoningEffort; model?: string; provider: string },
  ): Promise<void> => {
    if (model === undefined) {
      if (effort !== undefined) await this.#get().updateTopicHeteroEffort(id, effort);
      return;
    }
    /** Model resets and later effort selections must share one persistence order. */
    await this.#enqueueTopicEffortWrite(id, () =>
      this.#writeTopicModelPin(id, {
        metadata: effort === undefined ? undefined : { heteroEffort: effort },
        model,
        provider,
      }),
    );
  };

  #topicEffortWrites = new Map<string, Promise<void>>();

  /** Serialize the full optimistic write/RPC/refresh cycle so earlier selections cannot land last. */
  #enqueueTopicEffortWrite = async (id: string, write: () => Promise<void>): Promise<void> => {
    const previous = this.#topicEffortWrites.get(id);
    /** Failures already revalidate and toast; a rejected write must not poison the next selection. */
    const pending = (previous ? previous.catch(() => {}) : Promise.resolve()).then(write);
    this.#topicEffortWrites.set(id, pending);
    this.#set(
      (s) => ({
        topicEffortUpdatingIds: s.topicEffortUpdatingIds.includes(id)
          ? s.topicEffortUpdatingIds
          : [...s.topicEffortUpdatingIds, id],
      }),
      false,
      n('topicEffort/start'),
    );
    try {
      await pending;
    } finally {
      if (this.#topicEffortWrites.get(id) === pending) {
        this.#topicEffortWrites.delete(id);
        this.#set(
          (s) => ({ topicEffortUpdatingIds: s.topicEffortUpdatingIds.filter((key) => key !== id) }),
          false,
          n('topicEffort/end'),
        );
      }
    }
  };

  /**
   * `updateTopicMetadata` shows the new value optimistically and has no
   * rollback, so a failed effort write would leave the picker (and client-side
   * generation) on a value that was never persisted. Revalidate and tell the
   * user, mirroring `updateModelReasoningConfig` for the user-level default.
   */
  #writeTopicEffortPin = async (
    id: string,
    metadata: Pick<ChatTopicMetadata, 'heteroEffort' | 'reasoningConfig'>,
  ): Promise<void> => {
    const { activeAgentId, activeGroupId } = this.#get();
    const containerKey =
      topicSelectors.getTopicContainerKeyById(id)(this.#get()) ??
      topicMapKey({ agentId: activeAgentId, groupId: activeGroupId });
    const previous = topicSelectors.getTopicById(id)(this.#get());
    if (!previous) return;
    this.#get().internal_dispatchTopic({
      containerKey,
      id,
      type: 'updateTopic',
      value: { metadata: { ...previous.metadata, ...metadata } },
    });
    try {
      await topicService.updateTopicMetadata(id, metadata);
    } catch (error) {
      if (previous) {
        this.#get().internal_dispatchTopic({
          containerKey,
          id,
          type: 'updateTopic',
          value: { metadata: previous.metadata },
        });
      }
      await this.#recoverTopicPinWrite(containerKey, error);
    }
    await this.#get().refreshTopic(containerKey);
  };

  /** Local rollback must survive an offline refresh and preserve the original write failure. */
  #recoverTopicPinWrite = async (
    containerKey: string | undefined,
    error: unknown,
  ): Promise<never> => {
    toast.error(t('reasoningEffort.updateFailed', { ns: 'chat' }));
    try {
      await this.#get().refreshTopic(containerKey);
    } catch (refreshError) {
      console.error('[topicPin] Failed to revalidate after rollback:', refreshError);
    }
    throw error;
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

  /**
   * Reconcile ONE server-sourced row against the pending optimistic writes.
   *
   * Every path that brings a topic row back from the server must go through
   * here before the row reaches the store — list fetches, search, and the
   * single-topic pull in {@link syncScheduledTopicRun} alike. A path that
   * bypasses it silently reverts whatever the user just did, and the reader
   * that trips it is usually the one the optimistic write itself woke up.
   *
   * Returns the row to trust: the fetched one, or the fetched one with the
   * pending status re-applied when it predates the write.
   */
  #applyPendingStatusWrite = (item: ChatTopic, source: PendingTopicStatusSource): ChatTopic => {
    const pending = this.#pendingTopicStatusWrites.get(item.id);
    if (!pending) return item;
    if (pending.expiresAt <= Date.now()) {
      this.#pendingTopicStatusWrites.delete(item.id);
      return item;
    }
    if (item.status === pending.status) {
      if (source === 'server') this.#pendingTopicStatusWrites.delete(item.id);
      return item;
    }
    return { ...item, status: pending.status };
  };

  /**
   * Apply pending terminal statuses before a fetched topic list enters SWR.
   *
   * Reconciling only in `onData` keeps Zustand correct but is too late for the
   * persisted cache: SWR has already accepted the older raw response and can
   * flush `running` to IndexedDB. After the 15-second pin expires, remounting
   * the sidebar restores that stale spinner. This step deliberately
   * handles statuses only; client-only optimistic rows are still added later by
   * {@link #reconcileFetchedTopics} and never enter the persisted response.
   * Persisting the pin also means a failed write can survive until the next
   * successful revalidation; that bounded, self-healing window is preferable to
   * reintroducing an older response after a confirmed local terminal event.
   */
  #applyPendingStatusWrites = (
    items: ChatTopic[],
    source: PendingTopicStatusSource,
  ): ChatTopic[] => {
    if (this.#pendingTopicStatusWrites.size === 0) return items;
    return items.map((item) => this.#applyPendingStatusWrite(item, source));
  };

  #reconcileFetchedTopics = (
    items: ChatTopic[],
    currentItems: ChatTopic[] | undefined,
    source: PendingTopicStatusSource,
  ): ChatTopic[] => {
    let next = this.#applyPendingStatusWrites(items, source);

    // In-flight first-send optimistic rows are client-only, so any refetch
    // landing mid-send (e.g. the fire-and-forget refreshTopic after a previous
    // run's topic creation or terminal) would wipe them from the sidebar until
    // the server confirms the topic. Re-prepend the ones still in the bucket —
    // they only ever leave it via replaceTopicId (send resolved) or deleteTopic
    // (rollback), never via a fetch.
    //
    // Membership comes from `creatingTopicIds`, not from the id string: the
    // placeholder carries a real `tpc_…` id the server is asked to honour, so
    // it is indistinguishable from a persisted one — and a prefix test would
    // fail silently the next time the id format changes.
    const creatingTopicIds = this.#get().creatingTopicIds;
    if (currentItems && currentItems.length > 0 && creatingTopicIds.length > 0) {
      const optimisticRows = currentItems.filter((item) => creatingTopicIds.includes(item.id));
      if (optimisticRows.length > 0) {
        const fetchedIds = new Set(next.map((item) => item.id));
        const surviving = optimisticRows.filter((item) => !fetchedIds.has(item.id));
        if (surviving.length > 0) next = [...surviving, ...next];
      }
    }

    return next;
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
  #prefetchUnreadTopicMessages = (
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

    this.internal_pinTopicStatus(params);

    // "Archive" in the UI writes status:'completed'. Stamp `completedAt` on that
    // transition so bulk/stale archive records when the topic was completed,
    // matching the single-item `markTopicCompleted`. Other status transitions
    // (agent runs → running/active/unread/…) leave `completedAt` untouched.
    const patch: Partial<ChatTopic> =
      status === 'completed' ? { completedAt: new Date(), status } : { status };

    await topicService.updateTopic(topicId, patch).catch((err) => {
      console.error('[updateTopicStatus] persist failed:', err);
      // The DB never got the write — stop pinning it over fetched rows.
      this.#pendingTopicStatusWrites.delete(topicId);
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
    const scopedAgentId = scope ? agentId : (agentId ?? state.activeAgentId);
    const scopedGroupId = scope ? groupId : (groupId ?? state.activeGroupId);
    const key = topicMapKey({
      agentId: scopedAgentId,
      groupId: scopedGroupId,
      scope,
    });
    const topic = state.topicDataMap[key]?.items?.find((t) => t.id === topicId);

    if (topic?.status === status) return;

    const patch: Partial<ChatTopic> =
      status === 'completed' ? { completedAt: new Date(), status } : { status };

    this.#pendingTopicStatusWrites.set(topicId, { expiresAt: Date.now() + 15_000, status });

    // Scope on the payload routes the write to the owning bucket inside
    // `internal_dispatchTopic`. A no-op if the bucket isn't loaded; the pin
    // above still ensures the status sticks across the next refetch.
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
    const stored = topicSelectors.getTopicById(topicId)(this.#get());
    // Only a topic the store believes is parked needs syncing; anything else
    // already has a live update path (or isn't loaded in the active bucket).
    if (stored?.status !== 'scheduled') return false;

    const fetched = await topicService.getTopicDetail(topicId);
    if (!fetched) return false;

    // Same funnel every other server-sourced row goes through. It matters most
    // here: `updateTopicStatus` dispatches `scheduled` optimistically and
    // persists afterwards, and that dispatch is what arms this watch — so this
    // fetch routinely overtakes the write and answers with the PRE-schedule row.
    // Unreconciled, folding it in would revert the schedule the user just made
    // (the button reading as a no-op until pressed a second time). The pin is
    // dropped when the persist fails, so a write that never reached the DB
    // still reverts here.
    const fresh = this.#applyPendingStatusWrite(fetched, 'server');
    if (fresh.status !== fetched.status) return false;

    // Server still parked — nothing to fold in.
    if (fresh.status === 'scheduled' && fresh.metadata?.scheduledRun) return false;

    // Re-check after the await: a topic/agent switch mid-flight means the
    // active bucket no longer holds this row — don't patch a foreign bucket.
    if (topicSelectors.getTopicById(topicId)(this.#get())?.status !== 'scheduled') return false;

    this.#get().internal_dispatchTopic(
      {
        id: topicId,
        type: 'updateTopic',
        value: { metadata: fresh.metadata, status: fresh.status },
      },
      n('syncScheduledTopicRun'),
    );

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

  autoRenameTopicTitle = async (id: string, topicAgentId?: string): Promise<void> => {
    const { activeAgentId, summaryTopicTitle } = this.#get();
    const agentId = topicAgentId ?? activeAgentId;

    const messages = await messageService.getMessages({ agentId, topicId: id });

    await summaryTopicTitle(id, messages);
  };

  /**
   * One sidebar page (`cursor` = page index, `undefined` = head). The head
   * page also drives the page-size-expansion flag and the unread prefetch.
   */
  #fetchTopicListPage = async (
    { agentId, groupId, pageSize, ...query }: TopicListParams,
    cursor?: number,
  ): Promise<ReplicaPageResult<ChatTopic, number>> => {
    const containerKey = topicMapKey({ agentId, groupId });
    const isHead = cursor === undefined;
    const currentData = this.#get().topicDataMap[containerKey];
    const lastPageSize = currentData?.pageSize;

    // Only treat as "expanding page size" when user actually increases pageSize,
    // not when SWR revalidates or when total items < pageSize.
    const isExpanding =
      isHead &&
      (currentData?.items?.length || 0) > 0 &&
      typeof lastPageSize === 'number' &&
      pageSize > lastPageSize;
    if (isExpanding)
      this.#get().internal_updateTopicData(containerKey, { isExpandingPageSize: true });

    try {
      const result = await topicService.getTopics({
        agentId,
        current: cursor ?? 0,
        groupId,
        pageSize,
        ...query,
      });
      const items = this.#applyPendingStatusWrites(result.items, 'server');
      if (isHead)
        this.#prefetchUnreadTopicMessages(items, this.#get().topicDataMap[containerKey]?.items, {
          agentId,
          groupId,
        });
      return { items, total: result.total };
    } finally {
      if (isExpanding)
        this.#get().internal_updateTopicData(containerKey, { isExpandingPageSize: false });
    }
  };

  #fetchAgentViewPage = async (
    { agentId, pageSize, withDetails }: TopicAgentViewParams,
    cursor?: number,
  ): Promise<ReplicaPageResult<ChatTopic, number>> => {
    const result = await topicService.getTopics({
      agentId,
      current: cursor ?? 0,
      pageSize,
      withDetails,
    });
    return {
      items: this.#applyPendingStatusWrites(result.items, 'server'),
      total: result.total,
    };
  };

  /**
   * Fetch orchestration for a container's topic list. Hydrates the persisted
   * projection, then revalidates; results land in `topicDataMap` — read them
   * through `topicSelectors`, never from this hook.
   */
  useFetchTopics = (enable: boolean, params: Partial<TopicListParams> = {}): ReplicaSyncResult => {
    return this.#topicList.useSync(normalizeTopicListParams(params), { enabled: enable });
  };

  /**
   * Seed the sidebar's persisted page for a session before its first paint.
   *
   * Called from the agent route loader, where the route's agent is known but the
   * stores still hold the previously active one. Best-effort by contract: a miss
   * (nothing persisted for this key + query) is not an error, and the caller
   * bounds the wait — everything else still flows through `useSync`.
   */
  preHydrateTopicList = async (params: Partial<TopicListParams>): Promise<boolean> => {
    const normalized = normalizeTopicListParams(params);
    if (!normalized) return false;

    const scope = getCacheScope();
    // The slot may still hold the previous identity's rows (a session that ended
    // before the identity round-trip landed); drop them before seeding this one.
    this.#topicList.ensureScope(scope);

    return this.#topicList.hydrate(normalized, scope);
  };

  /**
   * By-id topic detail fetch, used as a fallback when a topic the UI is
   * anchored on is missing from the loaded list bucket — e.g. an archived
   * (`completed`) topic that the sidebar fetch excludes via `excludeStatuses`,
   * or a topic deep-linked from the Topics management page. The result lands
   * in `topicDetailMap`, which `currentActiveTopic` / `getTopicById` read as
   * a fallback. Pass `undefined` to disable the fetch.
   */
  useFetchTopicDetail = (topicId?: string | null): ReplicaSyncResult =>
    this.#topicDetail.useSync(topicId || null);

  /**
   * Topic fetch dedicated to the Agent Topics management page. Its own
   * resource and view (`agentTopicsViewMap`) so the heavier `withDetails`
   * payload never collides with the sidebar's cheap fetch. Read the rows
   * through `topicSelectors.agentTopicsView*`, never from this hook.
   */
  useFetchAgentTopicsView = (
    enable: boolean,
    {
      agentId,
      pageSize,
      withDetails,
    }: {
      agentId?: string;
      pageSize?: number;
      withDetails?: boolean;
    } = {},
  ): ReplicaSyncResult =>
    this.#topicAgentView.useSync(
      agentId ? { agentId, pageSize: pageSize || 30, withDetails: withDetails || undefined } : null,
      { enabled: enable },
    );

  loadMoreAgentTopicsView = async (): Promise<void> => {
    const { activeAgentId } = this.#get();
    if (!activeAgentId) return;
    const key = topicMapKey({ agentId: activeAgentId });
    const currentData = this.#get().agentTopicsViewMap[key];
    await this.#topicAgentView.loadMore(key, {
      agentId: activeAgentId,
      pageSize: currentData?.pageSize || 30,
      withDetails: currentData?.withDetails,
    });
  };

  refreshAgentTopicsView = async (): Promise<void> => {
    const { activeAgentId } = this.#get();
    if (!activeAgentId) return;
    await this.#topicAgentView.revalidate(topicMapKey({ agentId: activeAgentId }));
  };

  /**
   * Next sidebar page with the params of the loaded head page. A bucket
   * seeded outside `useFetchTopics` (e.g. `internal_updateTopics`) pages with
   * its own descriptors.
   */
  loadMoreTopics = async (): Promise<void> => {
    const { activeAgentId, activeGroupId, topicDataMap } = this.#get();
    if (!activeAgentId && !activeGroupId) return;
    const key = topicMapKey({ agentId: activeAgentId, groupId: activeGroupId });
    const currentData = topicDataMap[key];

    await this.#topicList.loadMore(key, {
      agentId: activeAgentId,
      excludeStatuses: currentData?.excludeStatuses,
      excludeTriggers: currentData?.excludeTriggers,
      groupId: activeGroupId,
      isInbox: currentData?.isInbox,
      pageSize: currentData?.pageSize || useGlobalStore.getState().status.topicPageSize || 20,
      sortBy: currentData?.sortBy,
      withDetails: currentData?.withDetails,
    });
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
            {
              isSearchingTopic: false,
              searchTopics: this.#reconcileFetchedTopics(data, undefined, 'server'),
            },
            false,
            n('useSearchTopics(success)', { keywords }),
          );
        },
      },
    );
  };

  switchTopic = async (id?: string | null, options?: SwitchTopicOptions): Promise<void> => {
    const opts = options ?? {};

    const { activeAgentId, activeGroupId } = this.#get();

    // Clear the _new key data in the following cases:
    // 1. When id is null or undefined (switching to empty topic state)
    // 2. When clearNewKey option is explicitly true
    // This prevents stale data from previous conversations showing up
    // Note: Use == null to match both null and undefined
    //
    // Housekeeping runs BEFORE the navigation guard below: a send whose
    // continuation is dropped because the user navigated away is still done
    // with the blank conversation it came from — the cleanup targets that
    // origin bucket (opts.clearNewKeyContext), never the view the user moved
    // to. In the normal (unguarded) case origin and current view are the same
    // conversation, so this is identical to cleaning up after the guard.
    const shouldClearNewKey = !id || opts.clearNewKey;

    if (shouldClearNewKey) {
      this.#get().clearPortalStack();
    }

    const cleanupAgentId = opts.clearNewKeyContext?.agentId ?? activeAgentId;
    const cleanupGroupId = opts.clearNewKeyContext?.groupId ?? activeGroupId;

    if (shouldClearNewKey && cleanupAgentId) {
      // Determine scope: use explicit scope, or infer from the cleanup group
      const scope =
        opts.clearNewKeyContext?.scope ?? opts.scope ?? (cleanupGroupId ? 'group' : 'main');

      this.#get().replaceMessages([], {
        context: {
          agentId: cleanupAgentId,
          groupId: cleanupGroupId,
          scope,
          topicId: null,
        },
        action: n('clearNewKeyData'),
      });
    }

    // Send-flow continuation guard: if the caller requires the user to still
    // be on a specific conversation and they've navigated elsewhere while the
    // send's awaits were in flight, drop the switch instead of yanking the UI
    // (and the URL, via ChatHydration's route sync) back to the sent topic.
    // The topic id alone cannot tell two blank views apart — a null origin and
    // a null destination look identical — so send flows also pin the agent and
    // group they started from. The epoch token below cannot catch any of this
    // — the user's switch happened in between, but this call is still the
    // newest one. Runs before the epoch bump: a skipped switch must not
    // invalidate a concurrent switch's pending revalidation.
    if (opts.onlyIfActiveTopicIn) {
      // `activeTopicId` uses `null` for "no topic" but is typed `string` and can
      // hold `undefined`/`''` from callers that never went through switchTopic,
      // so normalize before comparing — an unset field must still match an
      // explicit `null` expectation (the blank new-conversation view).
      const activeTopicId = this.#get().activeTopicId || null;
      if (!opts.onlyIfActiveTopicIn.includes(activeTopicId)) return;
    }
    if (
      opts.onlyIfActiveAgentId !== undefined &&
      (activeAgentId ?? null) !== opts.onlyIfActiveAgentId
    )
      return;
    if (
      opts.onlyIfActiveGroupId !== undefined &&
      (activeGroupId ?? null) !== opts.onlyIfActiveGroupId
    )
      return;

    const epoch = ++this.#switchTopicEpoch;

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
    this.#removeTopicDetails((topic) => topic.sessionId === activeAgentId);
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
    // Topic detail rows don't carry their group id, so the safe invalidation
    // boundary for a group-wide delete is the whole by-id detail cache.
    this.#removeTopicDetails(() => true);
    await refreshTopic();
    // drop every deleted topic's message cache (all belong to this group)
    void evictMessageCache((ctx) => ctx.groupId === groupId);

    // switch to default topic
    switchTopic(null);
  };

  removeAllTopics = async (): Promise<void> => {
    const { refreshTopic } = this.#get();

    await topicService.removeAllTopic();
    this.#removeTopicDetails(() => true);
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
    topicIds.forEach((id) =>
      this.#get().internal_dispatchTopic({ type: 'deleteTopic', id }, 'removeUnstarredTopic'),
    );
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
   * @param ownerContainerKey - Revalidate this `topicDataMap` bucket instead of
   *   the active agent/group one. Pass it whenever the affected row may live
   *   elsewhere (Agent Builder panels render another agent's conversation);
   *   omitting it refreshes whatever the page is showing.
   */
  refreshTopic = async (ownerContainerKey?: string): Promise<void> => {
    const { activeAgentId, activeGroupId } = this.#get();
    // Same container key the topic-list resource uses as its entry key.
    const containerKey =
      ownerContainerKey ?? topicMapKey({ agentId: activeAgentId, groupId: activeGroupId });
    const agentViewKey =
      ownerContainerKey ?? (activeAgentId ? topicMapKey({ agentId: activeAgentId }) : null);
    await Promise.all([
      this.#topicList.revalidate(containerKey),
      agentViewKey !== null && this.#topicAgentView.revalidate(agentViewKey),
    ]);
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
    // one that holds it, so the revalidation lands where the topic is actually
    // rendered (see `getTopicContainerKeyById`).
    const { activeAgentId, activeGroupId } = this.#get();
    const containerKey =
      topicSelectors.getTopicContainerKeyById(id)(this.#get()) ??
      topicMapKey({ agentId: activeAgentId, groupId: activeGroupId });

    // One overlay per resource holding the topic (sidebar, management page,
    // detail); all commit or all roll back with the single server call.
    await this.#topicEntity.optimistic(id, patchTopic(data), () =>
      topicService.updateTopic(id, data),
    );
    await this.#get().refreshTopic(containerKey);
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

    const topicId = await topicService.createTopic(params);
    await this.#get().refreshTopic();

    return topicId;
  };

  #removeTopicDetails = (predicate: (topic: ChatTopic) => boolean): void => {
    for (const [id, topic] of Object.entries(this.#get().topicDetailMap))
      if (predicate(topic)) this.#topicDetail.remove(id);
  };

  /**
   * Apply a topic reducer to a bucket in `topicDataMap`. Scope on the payload
   * (`agentId`/`groupId`) wins; otherwise falls back to the currently active
   * agent/group bucket. Pass scope on the payload when the write originates
   * outside the active UI context — e.g. an agent run finishing after the
   * user switched agents (see `updateTopicStatus`).
   */
  internal_dispatchTopic = (payload: ChatTopicDispatch, action?: any): void => {
    // Devtools names now come from the resource bindings (`t/topicList/update` …).
    void action;
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
      topicMapKey({
        agentId: scopedAgentId,
        groupId: scopedGroupId,
        scope: payload.scope,
      });

    switch (payload.type) {
      // Status / title patches and deletions are entity facts: they reach every
      // resource holding the topic and are persisted, so the next cold boot
      // never repaints them stale (e.g. a finished run's spinner).
      case 'updateTopic': {
        this.#topicEntity.update(payload.id, patchTopic(payload.value));
        return;
      }
      case 'deleteTopic': {
        this.#topicEntity.remove(payload.id);
        return;
      }
      // Adds and id swaps are list-structure placeholders until the server
      // list confirms them: memory only, in the target container.
      case 'addTopic': {
        this.#topicList.update(key, (bucket) => applyTopicDispatchToBucket(bucket, payload), {
          persist: false,
        });
        // The management page only gains the row once it has loaded that agent.
        this.#topicAgentView.update(
          key,
          (bucket) => bucket && applyTopicDispatchToBucket(bucket, payload),
          { persist: false },
        );
        return;
      }
      case 'replaceTopicId': {
        for (const slice of [this.#topicList, this.#topicAgentView])
          slice.update(key, (bucket) => applyTopicDispatchToBucket(bucket, payload), {
            persist: false,
          });
        const detail = this.#get().topicDetailMap[payload.id];
        if (detail && payload.nextId !== payload.id) {
          this.#topicDetail.remove(payload.id);
          this.#topicDetail.update(
            payload.nextId,
            () => ({ ...detail, ...payload.value, id: payload.nextId }),
            { persist: false },
          );
        }
      }
    }
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

    this.#topicList.update(
      key,
      (currentData) => {
        // Append mode keeps the existing items (optimistic rows included) in
        // front, so only pass them for reconciliation on full replacement.
        const items = this.#reconcileFetchedTopics(
          params.items,
          append ? undefined : currentData?.items,
          'cache',
        );
        const nextItems = append ? [...(currentData?.items || []), ...items] : items;

        return {
          currentPage,
          excludeStatuses: currentData?.excludeStatuses,
          excludeTriggers: currentData?.excludeTriggers,
          hasMore: total > nextItems.length,
          isInbox: currentData?.isInbox,
          isExpandingPageSize: false,
          isLoadingMore: false,
          items: nextItems,
          pageSize,
          sortBy: currentData?.sortBy,
          total,
        };
      },
      { persist: false },
    );
  };

  internal_updateTopicData = (key: string, data: Partial<TopicData>): void => {
    this.#topicList.update(key, (currentData) => currentData && { ...currentData, ...data }, {
      persist: false,
    });
  };
}

export type ChatTopicAction = Pick<ChatTopicActionImpl, keyof ChatTopicActionImpl>;

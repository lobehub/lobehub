// Disable the auto sort key eslint rule to make the code more logic and readable
import { LOADING_FLAT, TRACING_SCENARIOS } from '@lobechat/const';
import {
  chainSummaryTitle,
  TOPIC_TITLE_JSON_SCHEMA,
  TOPIC_TITLE_PROMPT_VERSION,
} from '@lobechat/prompts';
import {
  type CreateMessageParams,
  type IThreadType,
  RequestTrigger,
  type ThreadItem,
  type UIChatMessage,
} from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { aiChatService } from '@/services/aiChat';
import { threadService } from '@/services/thread';
import { threadSelectors } from '@/store/chat/selectors';
import { type ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { type StoreSetter } from '@/store/types';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors, userGeneralSettingsSelectors } from '@/store/user/selectors';
import { setNamespace } from '@/utils/storeDebug';

import { PortalViewType } from '../portal/initialState';
import { threadListResource } from './projection';
import { type ThreadDispatch } from './reducer';
import { threadReducer } from './reducer';
import { genParentMessages } from './selectors';

const n = setNamespace('thd');

type Setter = StoreSetter<ChatStore>;
/** Window in which mounts syncing the same topic share one request. */
export const THREAD_LIST_DEDUPING_INTERVAL = 10_000;

export const chatThreadMessage = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new ChatThreadActionImpl(set, get, _api);

export class ChatThreadActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;
  /** Sub-threads per topic, viewed as `threadMaps[topicId]`. */
  readonly #threadList;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#threadList = createReplicaSlice(threadListResource, {
      actionPrefix: n('threadList'),
      fetcher: (topicId) => threadService.getThreads(topicId),
      get,
      set,
      stateKey: 'threadListReplica',
      view: recordLens<ChatStore, ThreadItem[]>('threadMaps'),
    });
  }

  updateThreadInputMessage = (message: string): void => {
    if (isEqual(message, this.#get().threadInputMessage)) return;

    this.#set({ threadInputMessage: message }, false, n(`updateThreadInputMessage`, message));
  };

  openThreadCreator = (messageId: string): void => {
    const { activeAgentId, activeGroupId, activeTopicId, newThreadMode, replaceMessages } =
      this.#get();

    // Always use main scope key to get messages, not activeDisplayMessages,
    // because activeDisplayMessages includes activeThreadId in the key.
    // When inside a subtopic, that would return thread-scoped messages
    // instead of main conversation messages, causing the fork to fail ().
    const mainKey = messageMapKey({
      agentId: activeAgentId,
      groupId: activeGroupId,
      topicId: activeTopicId,
    });
    const displayMessages = this.#get().messagesMap[mainKey] || [];
    // Filter out messages that have threadId (they belong to other threads)
    const mainMessages = displayMessages.filter((m) => !m.threadId);
    const parentMessages = genParentMessages(mainMessages, messageId, newThreadMode);

    // Initialize messages in thread scope for optimistic update
    // This ensures the UI can display messages immediately
    if (parentMessages.length > 0) {
      const context = {
        agentId: activeAgentId,
        isNew: true,
        scope: 'thread' as const,
        topicId: activeTopicId,
      };
      replaceMessages(parentMessages, { action: 'initThreadMessages', context });
    }

    this.#set(
      { threadStartMessageId: messageId, portalThreadId: undefined, startToForkThread: true },
      false,
      'openThreadCreator',
    );
    // Push Thread view to portal stack instead of togglePortal
    this.#get().pushPortalView({ type: PortalViewType.Thread, startMessageId: messageId });
  };

  openThreadInPortal = (threadId: string, sourceMessageId?: string | null): void => {
    this.#set(
      { portalThreadId: threadId, threadStartMessageId: sourceMessageId, startToForkThread: false },
      false,
      'openThreadInPortal',
    );
    // Push Thread view to portal stack with threadId
    this.#get().pushPortalView({
      type: PortalViewType.Thread,
      threadId,
      startMessageId: sourceMessageId ?? undefined,
    });
  };

  /**
   * Sync the portal slice's thread state to a freshly-created thread *without*
   * pushing a Thread view onto the portal stack. Use after `sendMessage`
   * creates a thread from a panel-hosted ConversationProvider (e.g. the
   * Document portal's FloatingChatPanel) so portal-bound selectors resolve to
   * the persisted thread while the host view remains visible.
   */
  syncThreadInPortal = (threadId: string, sourceMessageId?: string | null): void => {
    this.#set(
      { portalThreadId: threadId, startToForkThread: false, threadStartMessageId: sourceMessageId },
      false,
      'syncThreadInPortal',
    );
  };

  closeThreadPortal = (): void => {
    this.#set(
      { threadStartMessageId: undefined, portalThreadId: undefined, startToForkThread: undefined },
      false,
      'closeThreadPortal',
    );
    this.#get().clearPortalStack();
  };

  createThread = async ({
    message,
    sourceMessageId,
    topicId,
    type,
  }: {
    message: CreateMessageParams;
    sourceMessageId: string;
    topicId: string;
    type: IThreadType;
  }): Promise<{ threadId: string; messageId: string }> => {
    this.#set({ isCreatingThread: true }, false, n('creatingThread/start'));

    const data = await threadService.createThreadWithMessage({
      topicId,
      sourceMessageId,
      type,
      message,
    });
    this.#set({ isCreatingThread: false }, false, n('creatingThread/end'));

    return data;
  };

  /**
   * Fetch orchestration for a topic's sub-threads. Hydrates the persisted list,
   * then revalidates; results land in `threadMaps` — read them through
   * `threadSelectors`, never from this hook.
   */
  useFetchThreads = (enable: boolean, topicId?: string): ReplicaSyncResult =>
    // The conversation's ThreadHydration and the sidebar list both sync the
    // active topic; collapse their mounts into one request.
    this.#threadList.useSync(topicId || null, {
      dedupingInterval: THREAD_LIST_DEDUPING_INTERVAL,
      enabled: enable,
    });

  /**
   * Seed a topic's persisted thread list before its first paint (route loader).
   * Best-effort: a miss is not an error, and the caller bounds the wait.
   */
  preHydrateThreads = async (topicId?: string): Promise<boolean> => {
    if (!topicId) return false;

    const scope = threadListResource.scope.get();
    this.#threadList.ensureScope(scope);

    return this.#threadList.hydrate(topicId, scope);
  };

  /**
   * Refetch the active topic's threads after a write, whether or not a list is
   * mounted. Fire-and-forget callers rely on it never rejecting.
   */
  refreshThreads = async (topicId = this.#get().activeTopicId): Promise<void> => {
    if (!topicId) return;

    try {
      await this.#threadList.fetch(topicId, { fresh: true });
    } catch (error) {
      console.error('[refreshThreads] failed to refresh threads:', error);
    }
  };

  removeThread = async (id: string): Promise<void> => {
    const topicId = this.#topicIdOfThread(id);

    if (topicId) {
      // Drops the row from the view and the persisted copy at once, so a failed
      // refetch (or a reload) cannot bring it back; rolls back if the server
      // rejects the delete.
      await this.#threadList.optimistic(
        topicId,
        (threads) => threads.filter((thread) => thread.id !== id),
        () => threadService.removeThread(id),
      );
    } else {
      await threadService.removeThread(id);
    }
    await this.#get().refreshThreads(topicId);

    if (this.#get().activeThreadId === id) {
      this.#set({ activeThreadId: undefined });
    }
  };

  switchThread = async (id: string): Promise<void> => {
    this.#set({ activeThreadId: id }, false, n('toggleTopic'));
  };

  updateThreadTitle = async (id: string, title: string): Promise<void> => {
    await this.#get().internal_updateThread(id, { title });
  };

  summaryThreadTitle = async (threadId: string, messages: UIChatMessage[]): Promise<void> => {
    const { internal_updateThreadTitleInSummary, internal_updateThreadLoading } = this.#get();
    const portalThread = threadSelectors.currentPortalThread(this.#get());
    if (!portalThread) return;

    internal_updateThreadTitleInSummary(threadId, LOADING_FLAT);

    const { model, provider } = systemAgentSelectors.thread(useUserStore.getState());

    const restorePreviousTitle = () => {
      internal_updateThreadTitleInSummary(threadId, portalThread.title);
    };

    // Structured generation, same as `summaryTopicTitle` — see the note there.
    internal_updateThreadLoading(threadId, true);
    try {
      const { data } = await aiChatService.generateJSON(
        {
          ...chainSummaryTitle(
            messages,
            userGeneralSettingsSelectors.currentResponseLanguage(useUserStore.getState()),
          ),
          metadata: { trigger: RequestTrigger.ThreadTitle },
          model,
          provider,
          schema: TOPIC_TITLE_JSON_SCHEMA,
          tracing: {
            promptVersion: TOPIC_TITLE_PROMPT_VERSION,
            scenario: TRACING_SCENARIOS.TopicTitle,
            schemaName: TOPIC_TITLE_JSON_SCHEMA.name,
          },
        },
        new AbortController(),
      );

      const title = (data as { title?: string } | undefined)?.title?.trim();
      if (!title) return restorePreviousTitle();

      await this.#get().internal_updateThread(threadId, { title });
    } catch (error) {
      console.error('[summaryThreadTitle] failed to generate a title:', error);
      restorePreviousTitle();
    } finally {
      internal_updateThreadLoading(threadId, false);
    }
  };

  internal_updateThreadTitleInSummary = (id: string, title: string): void => {
    this.#get().internal_dispatchThread(
      { type: 'updateThread', id, value: { title } },
      'updateThreadTitleInSummary',
    );
  };

  internal_updateThreadLoading = (id: string, loading: boolean): void => {
    this.#set(
      (state) => {
        if (loading) return { threadLoadingIds: [...state.threadLoadingIds, id] };

        return { threadLoadingIds: state.threadLoadingIds.filter((i) => i !== id) };
      },
      false,
      n('updateThreadLoading'),
    );
  };

  internal_updateThread = async (id: string, data: Partial<ThreadItem>): Promise<void> => {
    const topicId = this.#topicIdOfThread(id);
    if (!topicId) return;

    this.#get().internal_updateThreadLoading(id, true);
    try {
      // Rolls back on its own when the server rejects the update.
      await this.#threadList.optimistic(
        topicId,
        (threads) => threadReducer(threads, { type: 'updateThread', id, value: data }),
        () => threadService.updateThread(id, data),
      );
      await this.#get().refreshThreads(topicId);
    } finally {
      this.#get().internal_updateThreadLoading(id, false);
    }
  };

  /**
   * The topic whose list holds the thread — the one the user is looking at,
   * falling back to the active topic before any list has loaded.
   */
  #topicIdOfThread = (id: string): string | undefined => {
    const { activeTopicId, threadMaps } = this.#get();
    if (activeTopicId && threadMaps[activeTopicId]?.some((thread) => thread.id === id))
      return activeTopicId;

    const owner = Object.entries(threadMaps).find(([, threads]) =>
      threads?.some((thread) => thread.id === id),
    );

    return owner?.[0] ?? activeTopicId;
  };

  /**
   * Transient, in-memory patch of the active topic's threads (e.g. the loading
   * title while a summary generates). Never persisted: confirmed writes go
   * through `internal_updateThread`.
   */
  internal_dispatchThread = (payload: ThreadDispatch, _action?: string): void => {
    const topicId = this.#get().activeTopicId;
    if (!topicId) return;

    this.#threadList.update(topicId, (threads) => threads && threadReducer(threads, payload), {
      persist: false,
    });
  };
}

export type ChatThreadAction = Pick<ChatThreadActionImpl, keyof ChatThreadActionImpl>;

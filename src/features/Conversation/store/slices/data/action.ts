import { parse } from '@lobechat/conversation-flow';
import { type ConversationContext, type UIChatMessage } from '@lobechat/types';
import debug from 'debug';
import { type StateCreator } from 'zustand/vanilla';

import { messageService } from '@/services/message';
import { useChatStore } from '@/store/chat';
import { messageStateSelectors } from '@/store/chat/slices/message/selectors/messageState';
import { type ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { hoistCompressedGroups } from '../../../ChatList/utils/compressedGroupOrder';
import {
  findCompressedGroupToPage,
  getCompressedHistoryNextUntilId,
} from '../../../ChatList/utils/compressedHistory';
import { type Store as ConversationStore } from '../../action';
import { type State } from '../../initialState';
import { isSameConversationContext } from '../../utils/contextGuard';
import { type MessageDispatch } from './reducer';
import { messagesReducer } from './reducer';
import { dataSelectors } from './selectors';
import { stabilizeReferences } from './stabilizeReferences';

const log = debug('lobe-render:features:Conversation');

type PageSide = 'earlier' | 'later';

const PAGE_SIDES = {
  earlier: {
    error: 'earlierMessagesError',
    load: (...args) => useChatStore.getState().loadEarlierMessages(...args),
    loading: 'isLoadingEarlierMessages',
  },
  later: {
    error: 'laterMessagesError',
    load: (...args) => useChatStore.getState().loadLaterMessages(...args),
    loading: 'isLoadingLaterMessages',
  },
} satisfies Record<
  PageSide,
  {
    error: keyof State;
    load: ChatStore['loadEarlierMessages'];
    loading: keyof State;
  }
>;

/**
 * The conversation's rows as the chat store holds them: `dbMessages` is the
 * bucket itself, `displayMessages` its parsed list pinned to the previous
 * render's references (memo bailouts survive a re-parse).
 */
export const chatTranscriptState = (
  context: ConversationContext,
  skipFetch: boolean | undefined,
  previousDisplayMessages: UIChatMessage[],
): Pick<State, 'dbMessages' | 'displayMessages' | 'hasLaterMessages' | 'messagesInit'> => {
  const chat = useChatStore.getState();
  const bucket = messageMapKey(context);
  const rows = chat.dbMessagesMap[bucket];
  const parsed =
    rows &&
    (chat.messagesMap[bucket] ??
      parse(rows, undefined, { threadId: context.threadId ?? undefined }).flatList);
  return {
    dbMessages: rows ?? [],
    displayMessages: stabilizeReferences(previousDisplayMessages, parsed ?? []),
    hasLaterMessages: messageStateSelectors.hasLaterMessages(context)(chat),
    // An absent bucket is "not loaded yet"; `[]` is a loaded, empty transcript.
    // A conversation that never syncs has nothing to wait for.
    messagesInit: !!rows || !!skipFetch,
  };
};

/**
 * Data Actions
 *
 * The rows a conversation shows are its chat store bucket: the chat store
 * fetches, pages and persists them, and this store mirrors the bucket
 * one-way (`internal_syncChatTranscript`). Writes go to the chat store and
 * come back through that mirror. A static transcript (`messages` passed to the
 * provider) is held here instead and never synced.
 */
export interface DataAction {
  /**
   * Dispatch message updates for optimistic UI updates
   * This method updates the frontend state without persisting to database
   */
  internal_dispatchMessage: (
    payload: MessageDispatch,
    options?: { creationOrigin?: 'client' | 'server' },
  ) => void;

  /** Mirror the chat store bucket of the current context into this store. */
  internal_syncChatTranscript: () => void;

  /**
   * Page one compression group's older members on request: a later group's
   * unloaded members sit mid-transcript, where reaching the top never pages
   * them. Same loading and error state as `loadEarlierMessages`.
   */
  loadCompressedGroupHistory: (groupId: string, options?: { retry?: boolean }) => Promise<void>;

  /**
   * Load one round-aligned page of history older than the server's
   * newest-first window and prepend it to the transcript.
   * Self-guarding: no-ops while a page is in flight, once the beginning has
   * been reached, or when the conversation has no server-backed messages yet.
   *
   * Never rejects: a failure is kept in `earlierMessagesError` for the inline
   * error row. While that error stands, gesture-driven calls no-op so scrolling
   * does not silently re-fire a failing request; pass `{ retry: true }` from the
   * explicit Retry action to try again.
   *
   * Once the transcript has no older page left and its oldest row is a
   * compression group with unloaded members, the same call pages those
   * members instead (`compressedHistoryPages`), so scrolling up keeps going
   * through the original conversation the group compressed.
   */
  loadEarlierMessages: (options?: { retry?: boolean }) => Promise<void>;

  /**
   * Load the rounds after a forward transcript's loaded pages and append them.
   * Same contract as `loadEarlierMessages`, with its failure kept in
   * `laterMessagesError`.
   */
  loadLaterMessages: (options?: { retry?: boolean }) => Promise<void>;

  /**
   * Replace all messages with new data
   * Used for syncing after database operations (optimistic update pattern)
   *
   * @param messages - New messages array from database
   * @param options.expectedContext - Context captured when an async operation
   *   started. The rows belong to that conversation, so they land in its
   *   bucket even when this store has switched to another one since.
   */
  replaceMessages: (
    messages: UIChatMessage[],
    options?: { expectedContext?: ConversationContext },
  ) => void;

  /**
   * Switch message branch by updating the parent's activeBranchIndex
   *
   * @param messageId - The current message ID (with branch indicator)
   * @param branchIndex - The new branch index to switch to
   */
  switchMessageBranch: (messageId: string, branchIndex: number) => Promise<void>;
}

export const dataSlice: StateCreator<
  ConversationStore,
  [['zustand/devtools', never]],
  [],
  DataAction
> = (set, get) => {
  /** Hold a static transcript in this store (it has no chat store bucket). */
  const setStaticMessages = (messages: UIChatMessage[], action: string) =>
    set(
      {
        dbMessages: messages,
        displayMessages: stabilizeReferences(
          get().displayMessages,
          parse(messages, undefined, { threadId: get().context.threadId ?? undefined }).flatList,
        ),
      },
      false,
      action,
    );

  /** Resolves whether a transcript page was requested. */
  const loadPage = async (side: PageSide, options?: { retry?: boolean }): Promise<boolean> => {
    const { context, transcriptSource } = get();
    if (transcriptSource !== 'chat') return false;
    const { error: errorKey, load, loading } = PAGE_SIDES[side];
    if (get()[errorKey] !== undefined && !options?.retry) return false;

    const { error, started } = await load(context, {
      onStart: () =>
        set({ [errorKey]: undefined, [loading]: true }, false, `${side}Messages/start`),
    });
    if (!started) return false;
    get().internal_syncChatTranscript();

    // The flag is conversation-wide state: after a context switch it belongs
    // to the new conversation (reset by createEphemeralResetState), so a
    // late settle from the previous one must not clear it.
    if (!isSameConversationContext(context, get().context)) return true;
    set({ [errorKey]: error ?? undefined, [loading]: false }, false, `${side}Messages/end`);
    return true;
  };

  /**
   * Bumped per member-page request: a response that is no longer the latest
   * (the reader left the topic and came back, and paged again) is dropped,
   * since the context check alone cannot tell the two visits apart.
   */
  let compressedHistoryRequest = 0;

  /**
   * Page one compression group's older members: `groupId`, or the oldest row
   * when it is a group (see `loadEarlierMessages`).
   */
  const loadCompressedHistory = async (options?: { retry?: boolean }, groupId?: string) => {
    const { compressedHistoryPages, context, displayMessages, transcriptSource } = get();
    // Share views read through share-authorized endpoints; the member page is owner-only.
    if (transcriptSource !== 'chat' || !context.topicId) return;
    if (context.agentShareId || context.topicShareId) return;
    if (get().isLoadingEarlierMessages) return;
    // A gap's failure stays with its group, so the gap (not the top of the
    // list, which pages the oldest group) is where the reader retries it.
    const failed = groupId
      ? get().compressedHistoryError?.groupId === groupId
      : get().earlierMessagesError !== undefined;
    if (failed && !options?.retry) return;

    const group = groupId ? displayMessages.find((message) => message.id === groupId) : undefined;
    const target = groupId
      ? group && {
          group,
          untilId: getCompressedHistoryNextUntilId(group, compressedHistoryPages[groupId]),
        }
      : findCompressedGroupToPage(hoistCompressedGroups(displayMessages), compressedHistoryPages);
    if (!target?.untilId) return;

    const targetId = target.group.id;
    const request = ++compressedHistoryRequest;
    set(
      {
        ...(groupId ? { compressedHistoryError: undefined } : { earlierMessagesError: undefined }),
        isLoadingEarlierMessages: true,
      },
      false,
      'compressedHistory/start',
    );
    try {
      const page = await messageService.getCompressedGroupMembers({
        groupId: targetId,
        topicId: context.topicId,
        untilId: target.untilId,
      });
      if (request !== compressedHistoryRequest) return;
      if (!isSameConversationContext(context, get().context)) return;

      const previous = get().compressedHistoryPages[targetId];
      set(
        {
          compressedHistoryPages: {
            ...get().compressedHistoryPages,
            [targetId]: {
              messages: [...page.messages, ...(previous?.messages ?? [])],
              nextUntilId: page.nextUntilId,
            },
          },
          isLoadingEarlierMessages: false,
        },
        false,
        'compressedHistory/end',
      );
    } catch (error) {
      if (request !== compressedHistoryRequest) return;
      if (!isSameConversationContext(context, get().context)) return;
      log('[loadCompressedHistory] failed | group=%s | %O', targetId, error);
      set(
        {
          ...(groupId
            ? { compressedHistoryError: { error, groupId } }
            : { earlierMessagesError: error }),
          isLoadingEarlierMessages: false,
        },
        false,
        'compressedHistory/error',
      );
    }
  };

  return {
    internal_dispatchMessage: (payload, options) => {
      const { context, transcriptSource } = get();

      log(
        '[dispatchMessage] | contextKey=%s | type=%s | id=%s',
        messageMapKey(context),
        payload.type,
        'id' in payload ? payload.id : 'ids' in payload ? payload.ids.join(',') : 'N/A',
      );

      // Special handling for messageGroup metadata updates
      // MessageGroups are not in dbMessages, they're injected during query
      if (payload.type === 'updateMessageGroupMetadata') {
        const displayMessages = get().displayMessages;
        const index = displayMessages.findIndex((m) => m.id === payload.id);
        if (index < 0) return;

        const newDisplayMessages = [...displayMessages];
        newDisplayMessages[index] = {
          ...newDisplayMessages[index],
          metadata: { ...newDisplayMessages[index].metadata, ...payload.value },
        };

        set({ displayMessages: stabilizeReferences(displayMessages, newDisplayMessages) }, false, {
          payload,
          type: `dispatchMessage/${payload.type}`,
        });
        return;
      }

      if (transcriptSource === 'chat') {
        useChatStore
          .getState()
          .internal_dispatchMessage(payload, { conversationContext: context }, options);
        // Read the write back now, whether or not a mounted mirror subscribes.
        get().internal_syncChatTranscript();
        return;
      }

      const dbMessages = get().dbMessages;
      const newDbMessages = messagesReducer(dbMessages, payload);
      if (newDbMessages !== dbMessages)
        setStaticMessages(newDbMessages, `dispatchMessage/${payload.type}`);
    },

    internal_syncChatTranscript: () => {
      const { context, displayMessages, skipFetch, transcriptSource } = get();
      if (transcriptSource !== 'chat') return;
      const next = chatTranscriptState(context, skipFetch, displayMessages);
      const state = get();
      if (
        next.dbMessages === state.dbMessages &&
        next.displayMessages === state.displayMessages &&
        next.hasLaterMessages === state.hasLaterMessages &&
        next.messagesInit === state.messagesInit
      )
        return;
      set(next, false, 'syncChatTranscript');
    },

    loadCompressedGroupHistory: async (groupId, options) => {
      await loadCompressedHistory(options, groupId);
    },

    loadEarlierMessages: async (options) => {
      if (await loadPage('earlier', options)) return;
      await loadCompressedHistory(options);
    },

    loadLaterMessages: async (options) => {
      await loadPage('later', options);
    },

    replaceMessages: (messages, options) => {
      const { context, transcriptSource } = get();
      const target = options?.expectedContext ?? context;

      log(
        '[replaceMessages] | contextKey=%s | newCount=%d',
        messageMapKey(target),
        messages.length,
      );

      if (transcriptSource === 'chat') {
        useChatStore.getState().replaceMessages(messages, { context: target });
        get().internal_syncChatTranscript();
        return;
      }

      if (!isSameConversationContext(target, context)) return;
      setStaticMessages(messages, 'replaceMessages');
    },

    switchMessageBranch: async (messageId, branchIndex) => {
      const state = get();

      // Get the current message to find its parent
      const message = dataSelectors.getDbMessageById(messageId)(state);
      if (!message || !message.parentId) return;

      // Invalidate pending automatic recovery before a historical error can mount.
      useChatStore.getState().revokeHeteroAutoRetry(state.context);

      // Update the parent's metadata.activeBranchIndex
      // because the branch indicator is on the child message,
      // but the activeBranchIndex is stored on the parent
      await state.updateMessageMetadata(message.parentId, { activeBranchIndex: branchIndex });
    },
  };
};

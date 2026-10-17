import { parse } from '@lobechat/conversation-flow';
import { type ConversationContext, type UIChatMessage } from '@lobechat/types';
import debug from 'debug';
import { type StateCreator } from 'zustand/vanilla';

import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { type Store as ConversationStore } from '../../action';
import { type State } from '../../initialState';
import { isSameConversationContext } from '../../utils/contextGuard';
import { type MessageDispatch } from './reducer';
import { messagesReducer } from './reducer';
import { dataSelectors } from './selectors';
import { stabilizeReferences } from './stabilizeReferences';

const log = debug('lobe-render:features:Conversation');

/**
 * The conversation's rows as the chat store holds them: `dbMessages` is the
 * bucket itself, `displayMessages` its parsed list pinned to the previous
 * render's references (memo bailouts survive a re-parse).
 */
export const chatTranscriptState = (
  context: ConversationContext,
  skipFetch: boolean | undefined,
  previousDisplayMessages: UIChatMessage[],
): Pick<State, 'dbMessages' | 'displayMessages' | 'messagesInit'> => {
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
  internal_dispatchMessage: (payload: MessageDispatch) => void;

  /** Mirror the chat store bucket of the current context into this store. */
  internal_syncChatTranscript: () => void;

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
   */
  loadEarlierMessages: (options?: { retry?: boolean }) => Promise<void>;

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

  return {
    internal_dispatchMessage: (payload) => {
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
        useChatStore.getState().internal_dispatchMessage(payload, { conversationContext: context });
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
        next.messagesInit === state.messagesInit
      )
        return;
      set(next, false, 'syncChatTranscript');
    },

    loadEarlierMessages: async (options) => {
      const { context, transcriptSource } = get();
      if (transcriptSource !== 'chat') return;
      if (get().earlierMessagesError !== undefined && !options?.retry) return;

      const { error, started } = await useChatStore.getState().loadEarlierMessages(context, {
        onStart: () =>
          set(
            { earlierMessagesError: undefined, isLoadingEarlierMessages: true },
            false,
            'loadEarlierMessages/start',
          ),
      });
      if (!started) return;
      get().internal_syncChatTranscript();

      // The flag is conversation-wide state: after a context switch it belongs
      // to the new conversation (reset by createEphemeralResetState), so a
      // late settle from the previous one must not clear it.
      if (!isSameConversationContext(context, get().context)) return;
      set(
        { earlierMessagesError: error ?? undefined, isLoadingEarlierMessages: false },
        false,
        'loadEarlierMessages/end',
      );
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

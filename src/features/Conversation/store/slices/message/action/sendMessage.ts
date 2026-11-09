import {
  type ChatContextContent,
  type ConversationContext,
  type SendMessageParams,
} from '@lobechat/types';

import { useChatStore } from '@/store/chat';
import { readSendEditorState } from '@/store/chat/slices/agentRun/actions/entries/conversationLifecycle/sendEditorState';
import { isLocalOnlyMessage } from '@/store/chat/utils/localMessages';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { type Store as ConversationStore } from '../../../action';

const throwIfAborted = (signal?: AbortSignal) => {
  if (!signal?.aborted) return;

  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Message send was cancelled', 'AbortError');
};

export interface ConversationSendMessageParams extends Omit<
  SendMessageParams,
  'onPreflightFailure'
> {
  /** Internal override used by long-lived media transactions after a topic is created. */
  conversationContext?: ConversationContext;
  failedDraftContextSelections?: ChatContextContent[];
  /** Recover a composer cleared before an asynchronous provider hook refuses the send. */
  onBeforeSendFailure?: (editorRestored?: boolean) => void;
  onFailedSendDraftRetained?: (id: string) => void;
  onPreflightFailure?: (editorRestored?: boolean, hasOperation?: boolean) => void;
  retainFailedDraftOnRestore?: boolean;
}

/**
 * Send a message in this conversation
 *
 * This is a simplified wrapper that:
 * 1. Calls lifecycle hooks
 * 2. Forwards to ChatStore.sendMessage with context
 * 3. Passes displayMessages while the provider still owns the target context
 *
 * All actual message sending logic lives in ChatStore.
 */
export const sendMessage = (
  set: (partial: Partial<ConversationStore>) => void,
  get: () => ConversationStore,
) => {
  return async (params: ConversationSendMessageParams) => {
    const { conversationContext, onBeforeSendFailure, ...sendParams } = params;
    throwIfAborted(sendParams.signal);
    const state = get();
    const { context, editor, hooks, displayMessages } = state;
    const targetContext = conversationContext ?? context;
    const { preserveComposer } = sendParams;
    const inputEditorSnapshot = preserveComposer
      ? undefined
      : { json: JSON.stringify(readSendEditorState(editor)) };

    // ===== Hook: onBeforeSendMessage =====
    if (hooks.onBeforeSendMessage) {
      let result: boolean | void;
      try {
        result = await hooks.onBeforeSendMessage(sendParams);
      } catch (error) {
        onBeforeSendFailure?.(false);
        sendParams.onPreflightFailure?.(false);
        throw error;
      }
      if (result === false) {
        console.info('[ConversationStore] sendMessage blocked by onBeforeSendMessage hook');
        onBeforeSendFailure?.(false);
        sendParams.onPreflightFailure?.(false);
        return;
      }

      throwIfAborted(sendParams.signal);
    }

    // Keep ConversationStore in sync with the editor, which is cleared immediately on send.
    // Do this before awaiting the full streaming lifecycle so drafts typed during generation
    // are not overwritten when the request completes.
    if (!preserveComposer) set({ inputMessage: '' });

    // Get global chat store
    const chatStore = useChatStore.getState();
    const usesProviderContext = messageMapKey(targetContext) === messageMapKey(context);
    const sourceMessages =
      sendParams.messages ?? (usesProviderContext ? displayMessages : undefined);
    const messages = sourceMessages?.filter((message) => !isLocalOnlyMessage(message));

    // Forward to ChatStore.sendMessage with context and messages
    // Pass displayMessages only while this provider still owns the target context. A migrated
    // media transaction must let ChatStore read the real topic bucket instead of forwarding the
    // unmounted `_new` provider's stale snapshot.
    // `onTopicCreated` is invoked from inside ChatStore.sendMessage as soon as
    // the backend reports a new topic id (only under isolatedTopic contexts),
    // not here after the full streaming lifecycle — otherwise the isolated
    // UI would not see the AI response while it is still streaming.
    const result = await chatStore.sendMessage({
      ...sendParams,
      context: targetContext,
      inputEditor: editor,
      inputEditorSnapshot,
      isInputEditorCurrent: () =>
        get().editor === editor && messageMapKey(get().context) === messageMapKey(targetContext),
      ...(messages ? { messages } : undefined),
      onTopicCreated: hooks.onTopicCreated,
      failedDraftContextSelections: params.failedDraftContextSelections,
      onFailedSendDraftRetained: params.onFailedSendDraftRetained,
      retainFailedDraftOnRestore: params.retainFailedDraftOnRestore,
    });

    // ===== Hook: onAfterMessageCreate =====
    // Called after messages are created but before AI response is complete
    if (result && hooks.onAfterMessageCreate) {
      await hooks.onAfterMessageCreate({
        assistantMessageId: result.assistantMessageId,
        createdThreadId: result.createdThreadId,
        userMessageId: result.userMessageId,
      });
    }

    // ===== Hook: onAfterSendMessage =====
    if (hooks.onAfterSendMessage) {
      await hooks.onAfterSendMessage();
    }
  };
};

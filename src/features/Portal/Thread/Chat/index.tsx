'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, Suspense, useCallback, useMemo } from 'react';

import { type ConversationContext, type ConversationHooks } from '@/features/Conversation';
import {
  ChatInput,
  ChatList,
  ConversationProvider,
  conversationSelectors,
  MessageItem,
  useConversationStore,
} from '@/features/Conversation';
import SkeletonList from '@/features/Conversation/components/SkeletonList';
import { useOperationState } from '@/hooks/useOperationState';
import { useChatStore } from '@/store/chat';
import { threadSelectors } from '@/store/chat/selectors';
import { type MessageMapKeyInput } from '@/store/chat/utils/messageMapKey';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import ThreadDivider from './ThreadDivider';
import { useThreadActionsBarConfig } from './useThreadActionsBarConfig';

/**
 * Inner component that uses ConversationStore for message rendering
 * Must be inside ConversationProvider to access the store
 */
const ThreadChatContent = memo(() => {
  // Get display messages from ConversationStore to determine thread divider position
  // With the new backend API, parent messages have threadId === null
  // and thread messages have threadId === context.threadId
  const displayMessages = useConversationStore(conversationSelectors.displayMessages);

  // Find the last parent message (source message) - it's the last message with threadId === null
  const threadSourceInfo = useMemo(() => {
    // Find the index of the last parent message (threadId is null or undefined)
    let sourceMessageIndex = -1;
    let sourceMessageId: string | undefined;

    for (const [i, msg] of displayMessages.entries()) {
      // Parent messages don't have threadId
      if (!msg.threadId) {
        sourceMessageIndex = i;
        sourceMessageId = msg.id;
      }
    }

    return { sourceMessageId, sourceMessageIndex };
  }, [displayMessages]);

  // Custom item content renderer for thread-specific features
  const itemContent = useCallback(
    (index: number, id: string) => {
      // Check if this message needs ThreadDivider (after thread source message)
      const enableThreadDivider = threadSourceInfo.sourceMessageId === id;

      // Check if this is a parent message (should be read-only)
      // Parent messages are those with index <= sourceMessageIndex
      const isParentMessage = index <= threadSourceInfo.sourceMessageIndex;

      return (
        <MessageItem
          inPortalThread
          disableEditing={isParentMessage}
          endRender={enableThreadDivider ? <ThreadDivider /> : undefined}
          id={id}
          index={index}
        />
      );
    },
    [threadSourceInfo.sourceMessageId, threadSourceInfo.sourceMessageIndex],
  );

  return (
    <>
      <Suspense
        fallback={
          <Flexbox flex={1} height={'100%'}>
            <SkeletonList />
          </Flexbox>
        }
      >
        <Flexbox
          flex={1}
          width={'100%'}
          style={{
            overflowX: 'hidden',
            overflowY: 'auto',
            position: 'relative',
          }}
        >
          <ChatList itemContent={itemContent} />
        </Flexbox>
      </Suspense>
      <ChatInput leftActions={['typo', 'stt', 'portalToken']} />
    </>
  );
});

ThreadChatContent.displayName = 'ThreadChatContent';

/**
 * Thread Chat Component
 *
 * Two modes:
 * 1. Creating new thread (!portalThreadId): Uses 'thread_xxx_new' key (isNew: true)
 * 2. Existing thread (portalThreadId): Uses 'thread_xxx_topicId_threadId' key
 */
const ThreadChat = memo(() => {
  // Get thread context from ChatStore
  const [activeAgentId, activeTopicId, portalThreadId, threadStartMessageId, newThreadMode] =
    useChatStore((s) => [
      s.activeAgentId,
      s.activeTopicId,
      s.portalThreadId,
      s.threadStartMessageId,
      s.newThreadMode,
    ]);

  // Get thread-specific actionsBar config
  const actionsBarConfig = useThreadActionsBarConfig();

  // Build ConversationContext for thread
  // When creating new thread (!portalThreadId), use isNew + scope: 'thread'
  const isCreatingNewThread = !portalThreadId && !!threadStartMessageId;

  // Context for ConversationProvider (includes sourceMessageId/threadType for new thread creation)
  const context: ConversationContext = useMemo(
    () => ({
      agentId: activeAgentId,
      // Use isNew + scope for new thread creation
      isNew: isCreatingNewThread,
      scope: 'thread',
      // Include source message info when creating a new thread
      sourceMessageId: isCreatingNewThread ? threadStartMessageId : undefined,
      threadId: portalThreadId,
      threadType: isCreatingNewThread ? newThreadMode : undefined,
      topicId: activeTopicId,
    }),
    [
      activeAgentId,
      activeTopicId,
      portalThreadId,
      threadStartMessageId,
      newThreadMode,
      isCreatingNewThread,
    ],
  );

  // Context for messageMapKey (only needs fields used in key generation)
  const keyContext = useMemo<MessageMapKeyInput>(
    () => ({
      agentId: activeAgentId,
      isNew: isCreatingNewThread,
      scope: 'thread',
      threadId: portalThreadId,
      topicId: activeTopicId,
    }),
    [activeAgentId, activeTopicId, portalThreadId, isCreatingNewThread],
  );

  // Generate messageMapKey for direct subscription to dbMessagesMap
  const chatKey = useMemo(() => messageMapKey(keyContext), [keyContext]);

  // Subscribe directly to dbMessagesMap for reactive updates
  // This ensures optimistic updates work (read/write use same key)
  const replaceMessages = useChatStore((s) => s.replaceMessages);
  const messages = useChatStore((s) => s.dbMessagesMap[chatKey]);

  // Get operation state for reactive updates
  const operationState = useOperationState(context);

  // Hooks to handle post-message-creation tasks for new thread
  const hooks: ConversationHooks = useMemo(
    () => ({
      onAfterMessageCreate: async ({ createdThreadId }) => {
        if (!createdThreadId) return;

        const state = useChatStore.getState();

        // Refresh threads list
        await state.refreshThreads();
        // Refresh messages to include new thread messages
        await state.refreshMessages();
        // Open the newly created thread in portal
        state.openThreadInPortal(createdThreadId, threadStartMessageId);

        // Summarize thread title for new thread
        const portalThread = threadSelectors.currentPortalThread(useChatStore.getState());
        if (portalThread) {
          const chats = threadSelectors.portalAIChats(useChatStore.getState());
          await useChatStore.getState().summaryThreadTitle(portalThread.id, chats);
        }
      },
    }),
    [threadStartMessageId],
  );

  return (
    <ConversationProvider
      actionsBar={actionsBarConfig}
      context={context}
      hasInitMessages={!!messages}
      hooks={hooks}
      messages={messages}
      operationState={operationState}
      skipFetch={isCreatingNewThread}
      onMessagesChange={(msgs, ctx) => {
        replaceMessages(msgs, { context: ctx });
      }}
    >
      <ThreadChatContent />
    </ConversationProvider>
  );
});

ThreadChat.displayName = 'ThreadChat';

export default ThreadChat;

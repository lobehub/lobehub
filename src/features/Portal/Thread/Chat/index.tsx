'use client';

import { type IThreadType, type UIChatMessage } from '@lobechat/types';
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
import { useChatFollowUp } from '@/features/Conversation/hooks/useChatFollowUp';
import { type ComposerTarget, resolveThreadComposerTarget } from '@/features/Conversation/types';
import { mergeConversationHooks } from '@/features/Conversation/utils/mergeConversationHooks';
import { useOperationState } from '@/hooks/useOperationState';
import HeterogeneousChatInput from '@/routes/(main)/agent/features/Conversation/HeterogeneousChatInput';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { portalThreadSelectors, threadSelectors } from '@/store/chat/selectors';
import { type MessageMapKeyInput } from '@/store/chat/utils/messageMapKey';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { getThreadInputMode } from './inputMode';
import ThreadDivider from './ThreadDivider';
import { useThreadActionsBarConfig } from './useThreadActionsBarConfig';

/**
 * Inner component that uses ConversationStore for message rendering
 * Must be inside ConversationProvider to access the store
 */
interface ThreadChatContentProps {
  composerWritable: boolean;
  /** The message this thread forked from — its anchor in the main conversation. */
  forkMessageId?: string;
  isHeterogeneousAgent: boolean;
  readOnly: boolean;
  threadType?: IThreadType;
}

const ThreadChatContent = memo<ThreadChatContentProps>(
  ({ composerWritable, forkMessageId, isHeterogeneousAgent, readOnly, threadType }) => {
    const inputMode = getThreadInputMode({
      isExternallyOwnedThread: readOnly,
      isHeterogeneousAgent,
    });
    const displayMessages = useConversationStore(conversationSelectors.displayMessages);

    // The portal knows its own fork point (`threadStartMessageId` while the
    // thread is being created, `thread.sourceMessageId` once it exists), so take
    // it from there rather than deriving it from the list. Deriving it as "the
    // last message without a threadId" breaks for the ~2s optimistic window
    // after send: the just-sent rows have no threadId yet either (the thread row
    // does not exist), so the scan walked past the fork point onto the assistant
    // placeholder. Kept as a fallback for callers that have neither.
    const sourceMessageId = useMemo(
      () => forkMessageId ?? displayMessages.findLast((msg) => !msg.threadId)?.id,
      [forkMessageId, displayMessages],
    );

    // Render the fork message and everything after it — the inherited main chat
    // above it is one click away and re-rendering it here just duplicates it.
    // The data layer keeps the full history, so AI context inheritance is
    // unchanged. Cutting by position (rather than by `threadId`) is what keeps
    // the user's own message visible during the optimistic window.
    const visibleIds = useMemo(() => {
      if (!sourceMessageId) return;
      const forkIndex = displayMessages.findIndex((msg) => msg.id === sourceMessageId);
      // Anchor not in this list (a bucket swap mid-flight): show everything
      // rather than blanking the panel.
      if (forkIndex < 0) return;
      return new Set(displayMessages.slice(forkIndex).map((msg) => msg.id));
    }, [displayMessages, sourceMessageId]);

    const filterItem = useCallback(
      (msg: UIChatMessage) => !visibleIds || visibleIds.has(msg.id),
      [visibleIds],
    );

    const itemContent = useCallback(
      (index: number, id: string) => {
        const isSourceMessage = id === sourceMessageId;

        return (
          <MessageItem
            inPortalThread
            disableEditing={readOnly || isSourceMessage}
            endRender={isSourceMessage ? <ThreadDivider threadType={threadType} /> : undefined}
            id={id}
            index={index}
          />
        );
      },
      [sourceMessageId, readOnly, threadType],
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
            style={{ overflowX: 'hidden', overflowY: 'auto', position: 'relative' }}
            width={'100%'}
          >
            <ChatList filterItem={filterItem} itemContent={itemContent} />
          </Flexbox>
        </Suspense>
        {composerWritable && inputMode === 'heterogeneous' && <HeterogeneousChatInput />}
        {composerWritable && inputMode === 'default' && (
          <ChatInput
            leftActions={['typo', 'voiceDictation']}
            rightActions={['voiceMessage', 'contextWindow']}
            // A subtopic runs on the conversation it forked from: mode, device,
            // working directory and approval all come from there and are not
            // separately settable here. Rendering the bar anyway put a row of
            // controls under the panel that only restated the parent's state.
            showControlBar={false}
          />
        )}
      </>
    );
  },
);

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

  // Subagent threads are auto-spawned by a parent tool call (CC's `Agent`
  // tool etc.); the external CLI owns the session so the user can't inject
  // new turns or mutate existing ones. `sourceToolCallId` is set by the
  // executor on every spawn — unambiguous marker to flip the thread into a
  // read-only record (hides composer, wipes per-message actions, disables
  // double-click editing).
  const portalThread = useChatStore(portalThreadSelectors.portalCurrentThread);
  const threadMetadataResolved = !portalThreadId || !!portalThread;
  const isSubagentThread = !!portalThread?.metadata?.sourceToolCallId;
  const threadAgentId = portalThread?.agentId || activeAgentId;
  const isHeterogeneousAgent = useAgentStore(
    agentByIdSelectors.isAgentHeterogeneousById(threadAgentId || ''),
  );

  // Get thread-specific actionsBar config
  const actionsBarConfig = useThreadActionsBarConfig({
    readonly: !threadMetadataResolved || isSubagentThread,
  });

  // Build ConversationContext for thread
  // When creating new thread (!portalThreadId), use isNew + scope: 'thread'
  const isCreatingNewThread = !portalThreadId && !!threadStartMessageId;

  // Context for ConversationProvider (includes sourceMessageId/threadType for new thread creation)
  const context: ConversationContext = useMemo(
    () => ({
      agentId: threadAgentId,
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
      threadAgentId,
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
      agentId: threadAgentId,
      isNew: isCreatingNewThread,
      scope: 'thread',
      threadId: portalThreadId,
      topicId: activeTopicId,
    }),
    [threadAgentId, activeTopicId, portalThreadId, isCreatingNewThread],
  );

  // Generate messageMapKey for direct subscription to dbMessagesMap
  const chatKey = useMemo(() => messageMapKey(keyContext), [keyContext]);
  const composerTarget = useMemo<ComposerTarget>(
    () =>
      resolveThreadComposerTarget({
        contextKey: chatKey,
        metadataResolved: threadMetadataResolved,
        sourceToolCallId: portalThread?.metadata?.sourceToolCallId,
      }),
    [chatKey, portalThread?.metadata?.sourceToolCallId, threadMetadataResolved],
  );

  // Subscribe directly to dbMessagesMap for reactive updates
  // This ensures optimistic updates work (read/write use same key)
  const replaceMessages = useChatStore((s) => s.replaceMessages);
  const messages = useChatStore((s) => s.dbMessagesMap[chatKey]);

  // Get operation state for reactive updates
  const operationState = useOperationState(context);

  const agentChatConfig = useAgentStore(
    chatConfigByIdSelectors.getChatConfigById(threadAgentId || ''),
  );
  const chatFollowUpHooks = useChatFollowUp({
    agentChatConfig,
    conversationKey: chatKey,
    threadId: portalThreadId ?? undefined,
    topicId: activeTopicId ?? undefined,
  });

  // Hooks to handle post-message-creation tasks for new thread
  const hooks: ConversationHooks = useMemo(
    () =>
      mergeConversationHooks(
        {
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
        },
        chatFollowUpHooks,
      ),
    [chatFollowUpHooks, threadStartMessageId],
  );

  return (
    <ConversationProvider
      actionsBar={actionsBarConfig}
      composerTarget={composerTarget}
      context={context}
      hasInitMessages={!!messages}
      hooks={hooks}
      messages={messages}
      operationState={operationState}
      skipFetch={isCreatingNewThread}
      onMessagesChange={(msgs, ctx, meta) => {
        replaceMessages(msgs, { context: ctx, source: meta?.source });
      }}
    >
      <ThreadChatContent
        composerWritable={composerTarget.writable}
        forkMessageId={threadStartMessageId ?? portalThread?.sourceMessageId ?? undefined}
        isHeterogeneousAgent={isHeterogeneousAgent}
        readOnly={!composerTarget.writable}
        threadType={isCreatingNewThread ? newThreadMode : portalThread?.type}
      />
    </ConversationProvider>
  );
});

ThreadChat.displayName = 'ThreadChat';

export default ThreadChat;

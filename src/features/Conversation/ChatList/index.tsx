'use client';

import { Flexbox } from '@lobehub/ui';
import type { ReactNode } from 'react';
import { memo, useCallback } from 'react';

import AsyncError from '@/components/AsyncError';
import { useFetchTopicMemories } from '@/hooks/useFetchMemoryForTopic';
import { useFetchNotebookDocuments } from '@/hooks/useFetchNotebookDocuments';
import { getMessageListCacheIdentity } from '@/services/message/cache';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors, settingsSelectors } from '@/store/user/selectors';

import WideScreenContainer from '../../WideScreenContainer';
import SkeletonList from '../components/SkeletonList';
import MessageItem from '../Messages';
import type { WorkflowExpandLevelDefault } from '../Messages/AssistantGroup/components/WorkflowCollapse';
import { MessageActionProvider } from '../Messages/Contexts/MessageActionProvider';
import { dataSelectors, useConversationStore } from '../store';
import AgentSignalReceiptList from './components/AgentSignalReceiptList';
import { RefreshError } from './components/RefreshError';
import VirtualizedList from './components/VirtualizedList';
import { useAgentSignalReceipts } from './hooks/useAgentSignalReceipts';
import { useMessageRefreshError } from './hooks/useMessageRefreshError';
import { resolveMessageListFeedback } from './resolveMessageListFeedback';

export interface ChatListProps {
  /**
   * Default expand level for assistant workflow (tool-call) groups. When set,
   * pins the initial/reset state and skips the built-in auto-collapse after
   * streaming. Users can still toggle locally.
   * - 'collapsed': show summary only
   * - 'semi': constrained scrollable tool list
   * - 'full': all tool details expanded
   * Pass an object (e.g. `{ streaming: 'full' }`) to override only one phase.
   * Only applies to the default item renderer; ignored when `itemContent` is supplied.
   */
  defaultWorkflowExpandLevel?: WorkflowExpandLevelDefault;
  /**
   * Disable the actions bar for all messages (e.g., in share page)
   */
  disableActionsBar?: boolean;
  /**
   * Optional content rendered as the last item inside the virtualized list —
   * scrolls with the messages instead of being pinned to the viewport bottom.
   * Used e.g. for the SubAgent read-only hint after the last message.
   */
  footerSlot?: ReactNode;
  /**
   * Optional content rendered as the first item inside the virtualized list.
   * It scrolls with messages and does not participate in conversation state.
   */
  headerSlot?: ReactNode;
  /**
   * Custom item renderer. If not provided, uses default ChatItem.
   */
  itemContent?: (index: number, id: string) => ReactNode;
  /**
   * Force showing welcome component even when messages exist
   */
  showWelcome?: boolean;
  /**
   * Welcome component to display when there are no messages
   */
  welcome?: ReactNode;
}
/**
 * ChatList component for Conversation
 *
 * Uses ConversationStore for message data and fetching.
 */
const ChatList = memo<ChatListProps>(
  ({
    defaultWorkflowExpandLevel,
    disableActionsBar,
    footerSlot,
    headerSlot,
    welcome,
    itemContent,
    showWelcome,
  }) => {
    // Fetch messages (SWR key is null when skipFetch is true)
    const context = useConversationStore((s) => s.context);
    const enableUserMemories = useUserStore(settingsSelectors.memoryEnabled);
    const [skipFetch, useFetchMessages] = useConversationStore((s) => [
      dataSelectors.skipFetch(s),
      s.useFetchMessages,
    ]);
    const activeAgentId = useChatStore((s) => s.activeAgentId);
    // Suppress SWR focus revalidate while the current topic is streaming —
    // the server-pushed UIChatMessage[] snapshot at step boundaries is the
    // source of truth during that window. A focus refetch could hit DB
    // mid-fan-out and clobber the in-memory streamed state with a stale
    // assistant placeholder.
    const isStreaming = useChatStore(operationSelectors.isAgentRuntimeRunningByContext(context));
    const { enableAgentSelfIteration } = useServerConfigStore(featureFlagsSelectors);
    const messagesSWR = useFetchMessages(context, { revalidateOnFocus: !isStreaming, skipFetch });
    const refreshError = useMessageRefreshError({
      error: messagesSWR.error,
      identity: getMessageListCacheIdentity(context),
      isValidating: messagesSWR.isValidating,
      mutate: messagesSWR.mutate,
    });
    const displayMessages = useConversationStore(dataSelectors.displayMessages);
    const displayMessageIds = useConversationStore(dataSelectors.displayMessageIds);
    const latestMessageId = displayMessageIds.at(-1);

    // Skip fetching notebook and memories for share pages (they require authentication)
    const isSharePage = !!context.topicShareId;
    // TODO: Migrate Agent Signal receipts behind a dedicated user-visible receipt capability.
    const canShowAgentSignalReceipts = enableAgentSelfIteration === true && !isSharePage;
    const { receiptsByAnchor } = useAgentSignalReceipts({
      agentId: canShowAgentSignalReceipts ? activeAgentId : undefined,
      displayMessages,
      enabled: canShowAgentSignalReceipts,
      pollingSignal: latestMessageId,
      topicId: canShowAgentSignalReceipts ? context.topicId : undefined,
    });

    // Ensure this conversation's agent config (meta) is loaded into the agent
    // store, so message author titles resolve via useAgentMeta instead of
    // falling back to "Untitled Agent". Route-level layouts already init the
    // active agent, but secondary mounts never do — each Fleet column shows a
    // different agent, and the share page mounts an arbitrary author's agent;
    // without this they render "未命名助理".
    // Idempotent: SWR dedupes against any route-level init by the same key,
    // and is gated on isLogin (no fetch for anonymous share viewers).
    const isLogin = useUserStore(authSelectors.isLogin);
    const useFetchAgentConfig = useAgentStore((s) => s.useFetchAgentConfig);
    useFetchAgentConfig(isLogin, context.agentId);

    // Fetch conversation context data when a conversation is visible (skip for share pages).
    // NOTE: the agent-document list is intentionally NOT pre-warmed here — this
    // mount discarded its result (nothing in the message list renders documents),
    // yet it pulled the full unbounded list into the homepage batch. The surfaces
    // that actually render documents (working sidebar / doc page) fetch on their
    // own mount; the slash menu fetches the slim `non-web` variant.
    useFetchNotebookDocuments(isSharePage ? undefined : context.topicId!);
    useFetchTopicMemories(enableUserMemories && !isSharePage ? context.topicId : undefined);

    // Use selectors for data

    const defaultItemContent = useCallback(
      (index: number, id: string) => {
        const isLatestItem = displayMessageIds.length === index + 1;
        const anchoredReceipts = receiptsByAnchor.get(id) ?? [];
        const receiptRender =
          anchoredReceipts.length > 0 ? (
            <AgentSignalReceiptList receipts={anchoredReceipts} />
          ) : undefined;

        return (
          <MessageItem
            defaultWorkflowExpandLevel={defaultWorkflowExpandLevel}
            footerRender={receiptRender}
            id={id}
            index={index}
            isLatestItem={isLatestItem}
          />
        );
      },
      [displayMessageIds.length, defaultWorkflowExpandLevel, receiptsByAnchor],
    );
    const messagesInit = useConversationStore(dataSelectors.messagesInit);

    // When topicId is null (new conversation), show welcome directly without waiting for fetch
    // because there's no server data to fetch - only local optimistic updates exist
    const isNewConversation = !context.topicId;
    const feedback = resolveMessageListFeedback({
      error: refreshError.error,
      isNewConversation,
      isStreaming,
      messagesInit,
    });

    // `messagesInit` is the settled-data signal: [] is a valid loaded result.
    // A first-load failure owns the whole surface, while a background failure
    // must preserve either the messages or the welcome state below.
    if (feedback.showFirstLoadError) {
      return (
        <AsyncError
          error={refreshError.error}
          retrying={refreshError.isRetrying}
          variant={'page'}
          onRetry={refreshError.retry}
        />
      );
    }

    if (feedback.showSkeleton) {
      return <SkeletonList />;
    }

    const content =
      (showWelcome || displayMessageIds.length === 0) && welcome ? (
        <WideScreenContainer
          style={{
            height: '100%',
          }}
          wrapperStyle={{
            minHeight: '100%',
            overflowY: 'auto',
          }}
        >
          {welcome}
        </WideScreenContainer>
      ) : (
        <MessageActionProvider withSingletonActionsBar={!disableActionsBar}>
          <VirtualizedList
            dataSource={displayMessageIds}
            footerSlot={footerSlot}
            headerSlot={headerSlot}
            itemContent={itemContent ?? defaultItemContent}
          />
        </MessageActionProvider>
      );

    return (
      <Flexbox style={{ height: '100%', minHeight: 0 }}>
        <Flexbox flex={1} style={{ minHeight: 0 }}>
          {content}
        </Flexbox>
        {feedback.showBackgroundError && (
          <RefreshError
            error={refreshError.error}
            retrying={refreshError.isRetrying}
            onRetry={refreshError.retry}
          />
        )}
      </Flexbox>
    );
  },
);

ChatList.displayName = 'ConversationChatList';

export default ChatList;

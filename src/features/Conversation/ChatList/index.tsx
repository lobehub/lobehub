'use client';

import { type ReactNode } from 'react';
import { memo, useCallback } from 'react';

import { useFetchAgentDocuments } from '@/hooks/useFetchAgentDocuments';
import { useFetchTopicMemories } from '@/hooks/useFetchMemoryForTopic';
import { useFetchNotebookDocuments } from '@/hooks/useFetchNotebookDocuments';
import { useChatStore } from '@/store/chat';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import WideScreenContainer from '../../WideScreenContainer';
import SkeletonList from '../components/SkeletonList';
import MessageItem from '../Messages';
import type { WorkflowExpandLevelDefault } from '../Messages/AssistantGroup/components/WorkflowCollapse';
import { MessageActionProvider } from '../Messages/Contexts/MessageActionProvider';
import { dataSelectors, useConversationStore } from '../store';
import AgentSignalReceiptList from './components/AgentSignalReceiptList';
import VirtualizedList from './components/VirtualizedList';
import { useAgentSignalReceipts } from './hooks/useAgentSignalReceipts';

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
  ({ defaultWorkflowExpandLevel, disableActionsBar, welcome, itemContent, showWelcome }) => {
    // Fetch messages (SWR key is null when skipFetch is true)
    const context = useConversationStore((s) => s.context);
    const enableUserMemories = useUserStore(settingsSelectors.memoryEnabled);
    const [skipFetch, useFetchMessages] = useConversationStore((s) => [
      dataSelectors.skipFetch(s),
      s.useFetchMessages,
    ]);
    const activeAgentId = useChatStore((s) => s.activeAgentId);
    const { enableAgentSelfIteration } = useServerConfigStore(featureFlagsSelectors);
    useFetchMessages(context, skipFetch);
    const displayMessageIds = useConversationStore(dataSelectors.displayMessageIds);
    const latestMessageId = displayMessageIds.at(-1);

    // Skip fetching notebook and memories for share pages (they require authentication)
    const isSharePage = !!context.topicShareId;
    // TODO: Migrate Agent Signal receipts behind a dedicated user-visible receipt capability.
    const canShowAgentSignalReceipts = enableAgentSelfIteration === true && !isSharePage;
    const { receiptsByAnchor, unanchoredReceipts } = useAgentSignalReceipts({
      agentId: canShowAgentSignalReceipts ? activeAgentId : undefined,
      enabled: canShowAgentSignalReceipts,
      pollingSignal: latestMessageId,
      topicId: canShowAgentSignalReceipts ? context.topicId : undefined,
    });

    // Fetch notebook documents when topic is selected (skip for share pages)
    useFetchAgentDocuments(isSharePage ? undefined : activeAgentId);
    useFetchNotebookDocuments(isSharePage ? undefined : context.topicId!);
    useFetchTopicMemories(enableUserMemories && !isSharePage ? context.topicId : undefined);

    // Use selectors for data

    const defaultItemContent = useCallback(
      (index: number, id: string) => {
        const isLatestItem = displayMessageIds.length === index + 1;
        const anchoredReceipts = receiptsByAnchor.get(id) ?? [];
        const latestUnanchoredReceipts = isLatestItem ? unanchoredReceipts : [];
        const receiptRender =
          anchoredReceipts.length > 0 || latestUnanchoredReceipts.length > 0 ? (
            <>
              <AgentSignalReceiptList receipts={anchoredReceipts} />
              <AgentSignalReceiptList receipts={latestUnanchoredReceipts} />
            </>
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
      [displayMessageIds.length, defaultWorkflowExpandLevel, receiptsByAnchor, unanchoredReceipts],
    );
    const messagesInit = useConversationStore(dataSelectors.messagesInit);

    // When topicId is null (new conversation), show welcome directly without waiting for fetch
    // because there's no server data to fetch - only local optimistic updates exist
    const isNewConversation = !context.topicId;

    if (!messagesInit && !isNewConversation) {
      return <SkeletonList />;
    }

    if ((showWelcome || displayMessageIds.length === 0) && welcome) {
      return (
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
      );
    }

    return (
      <MessageActionProvider withSingletonActionsBar={!disableActionsBar}>
        <VirtualizedList
          dataSource={displayMessageIds}
          itemContent={itemContent ?? defaultItemContent}
        />
      </MessageActionProvider>
    );
  },
);

ChatList.displayName = 'ConversationChatList';

export default ChatList;

'use client';

import { type ReactNode } from 'react';
import { memo, useCallback } from 'react';

import { useFetchAgentDocuments } from '@/hooks/useFetchAgentDocuments';
import { useFetchTopicMemories } from '@/hooks/useFetchMemoryForTopic';
import { useFetchNotebookDocuments } from '@/hooks/useFetchNotebookDocuments';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import WideScreenContainer from '../../WideScreenContainer';
import SkeletonList from '../components/SkeletonList';
import MessageItem from '../Messages';
import type { WorkflowExpandLevel } from '../Messages/AssistantGroup/components/WorkflowCollapse';
import { MessageActionProvider } from '../Messages/Contexts/MessageActionProvider';
import { dataSelectors, useConversationStore } from '../store';
import VirtualizedList from './components/VirtualizedList';

export interface ChatListProps {
  /**
   * Default expand level for assistant workflow (tool-call) groups. When set,
   * pins the initial/reset state and skips the built-in auto-collapse after
   * streaming. Users can still toggle locally.
   * - 'collapsed': show summary only
   * - 'semi': constrained scrollable tool list
   * - 'full': all tool details expanded
   * Only applies to the default item renderer; ignored when `itemContent` is supplied.
   */
  defaultWorkflowExpandLevel?: WorkflowExpandLevel;
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
    useFetchMessages(context, skipFetch);

    // Skip fetching notebook and memories for share pages (they require authentication)
    const isSharePage = !!context.topicShareId;

    // Fetch notebook documents when topic is selected (skip for share pages)
    useFetchAgentDocuments(isSharePage ? undefined : activeAgentId);
    useFetchNotebookDocuments(isSharePage ? undefined : context.topicId!);
    useFetchTopicMemories(enableUserMemories && !isSharePage ? context.topicId : undefined);

    // Use selectors for data

    const displayMessageIds = useConversationStore(dataSelectors.displayMessageIds);

    const defaultItemContent = useCallback(
      (index: number, id: string) => {
        const isLatestItem = displayMessageIds.length === index + 1;
        return (
          <MessageItem
            defaultWorkflowExpandLevel={defaultWorkflowExpandLevel}
            id={id}
            index={index}
            isLatestItem={isLatestItem}
          />
        );
      },
      [displayMessageIds.length, defaultWorkflowExpandLevel],
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

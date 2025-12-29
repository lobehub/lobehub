'use client';

import { type ReactNode, memo, useCallback } from 'react';

import { useFetchTopicMemories } from '@/hooks/useFetchMemoryForTopic';
import { useFetchNotebookDocuments } from '@/hooks/useFetchNotebookDocuments';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import WideScreenContainer from '../../WideScreenContainer';
import MessageItem from '../Messages';
import { MessageActionProvider } from '../Messages/Contexts/MessageActionProvider';
import SkeletonList from '../components/SkeletonList';
import { dataSelectors, useConversationStore } from '../store';
import VirtualizedList from './components/VirtualizedList';

export interface ChatListProps {
  /**
   * Custom item renderer. If not provided, uses default ChatItem.
   */
  itemContent?: (index: number, id: string) => ReactNode;
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
const ChatList = memo<ChatListProps>(({ welcome, itemContent }) => {
  // Fetch messages (SWR key is null when skipFetch is true)
  const context = useConversationStore((s) => s.context);
  const enableUserMemories = useUserStore(settingsSelectors.memoryEnabled);
  const [skipFetch, useFetchMessages] = useConversationStore((s) => [
    dataSelectors.skipFetch(s),
    s.useFetchMessages,
  ]);
  useFetchMessages(context, skipFetch);

  // Fetch notebook documents when topic is selected
  useFetchNotebookDocuments(context.topicId!);
  useFetchTopicMemories(enableUserMemories ? context.topicId : undefined);

  // Use selectors for data

  const displayMessageIds = useConversationStore(dataSelectors.displayMessageIds);

  const defaultItemContent = useCallback(
    (index: number, id: string) => {
      const isLatestItem = displayMessageIds.length === index + 1;
      return <MessageItem id={id} index={index} isLatestItem={isLatestItem} />;
    },
    [displayMessageIds.length],
  );
  const messagesInit = useConversationStore(dataSelectors.messagesInit);

  if (!messagesInit) {
    return <SkeletonList />;
  }

  if (displayMessageIds.length === 0) {
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
    <MessageActionProvider withSingletonActionsBar>
      <VirtualizedList
        dataSource={displayMessageIds}
        // isGenerating={isGenerating}
        itemContent={itemContent ?? defaultItemContent}
      />
    </MessageActionProvider>
  );
});

ChatList.displayName = 'ConversationChatList';

export default ChatList;

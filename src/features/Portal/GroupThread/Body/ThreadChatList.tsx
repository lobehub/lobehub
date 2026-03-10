'use client';

import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import VirtualizedList from '@/features/Conversation/ChatList/components/VirtualizedList';
import SkeletonList from '@/features/Conversation/components/SkeletonList';
import { MessageActionProvider } from '@/features/Conversation/Messages/Contexts/MessageActionProvider';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

import ThreadChatItem from './ThreadChatItem';

const ThreadChatList = memo(() => {
  const { t } = useTranslation('chat');
  const [isCurrentChatLoaded] = useChatStore((s) => [chatSelectors.isCurrentChatLoaded(s)]);
  const activeThreadAgentId = useAgentGroupStore((s) => s.activeThreadAgentId);

  // Get agent info for better empty state
  const agents = useSessionStore(sessionSelectors.currentGroupAgents);
  const currentAgent = agents?.find((agent) => agent.id === activeThreadAgentId);
  const agentTitle = currentAgent?.title || 'this agent';

  // Get thread message IDs using the chat selector with the active agent ID
  const data = useChatStore(chatSelectors.getThreadMessageIDs(activeThreadAgentId));

  const itemContent = useCallback(
    (index: number, id: string) => <ThreadChatItem id={id} index={index} />,
    [],
  );

  if (!isCurrentChatLoaded) return <SkeletonList />;

  if (data.length === 0) {
    return (
      <div
        style={{
          color: '#999',
          fontSize: '14px',
          padding: '32px 16px',
          textAlign: 'center',
        }}
      >
        {t('dm.placeholder', { agentTitle })}
      </div>
    );
  }

  return (
    <MessageActionProvider>
      <VirtualizedList dataSource={data} itemContent={itemContent} />
    </MessageActionProvider>
  );
});

export default ThreadChatList;

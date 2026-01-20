'use client';

import { type TaskDetail, ThreadStatus } from '@lobechat/types';
import { Block, Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, useMemo } from 'react';

import { useChatStore } from '@/store/chat';
import { displayMessageSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { InitializingState } from '../../Tasks/shared';
import CompletedState from './CompletedState';
import ProcessingState from './ProcessingState';

interface ClientTaskDetailProps {
  content?: string;
  messageId: string;
  taskDetail?: TaskDetail;
}

const ClientTaskDetail = memo<ClientTaskDetailProps>(({ taskDetail }) => {
  const threadId = taskDetail?.threadId;
  const isExecuting = taskDetail?.status === ThreadStatus.Processing;

  const [activeAgentId, activeTopicId, useFetchMessages] = useChatStore((s) => [
    s.activeAgentId,
    s.activeTopicId,
    s.useFetchMessages,
  ]);

  const threadContext = useMemo(
    () => ({
      agentId: activeAgentId,
      scope: 'thread' as const,
      threadId,
      topicId: activeTopicId,
    }),
    [activeAgentId, activeTopicId, threadId],
  );

  const threadMessageKey = useMemo(
    () => (threadId ? messageMapKey(threadContext) : null),
    [threadId],
  );

  // Fetch thread messages (skip when executing - messages come from real-time updates)
  useFetchMessages(threadContext, isExecuting);

  // Get thread messages from store using selector
  const threadMessages = useChatStore((s) =>
    threadMessageKey ? displayMessageSelectors.getDisplayMessagesByKey(threadMessageKey)(s) : [],
  );

  // Initializing state: no status yet (task just created, waiting for client execution)
  if (threadMessages.length === 0) {
    return <InitializingState />;
  }

  // Find the assistantGroup message which contains the children blocks
  const assistantGroupMessage = threadMessages.find((item) => item.role === 'assistantGroup');
  const instruction = threadMessages.find((item) => item.role === 'user')?.content;

  if (!assistantGroupMessage?.children || assistantGroupMessage.children.length === 0) {
    return <InitializingState />;
  }

  return (
    <Flexbox gap={8}>
      <Block padding={12} variant={'outlined'}>
        <span style={{ color: cssVar.colorTextSecondary }}>{instruction}</span>
      </Block>
      {isExecuting ? (
        <ProcessingState
          assistantId={assistantGroupMessage.id}
          blocks={assistantGroupMessage.children}
        />
      ) : (
        <CompletedState
          assistantId={assistantGroupMessage.id}
          blocks={assistantGroupMessage.children}
        />
      )}
    </Flexbox>
  );
});

ClientTaskDetail.displayName = 'ClientClientTaskDetail';

export default ClientTaskDetail;

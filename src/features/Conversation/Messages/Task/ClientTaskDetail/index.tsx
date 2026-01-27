'use client';

import { type TaskDetail, ThreadStatus } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import BubblesLoading from '@/components/BubblesLoading';
import { useChatStore } from '@/store/chat';
import { displayMessageSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import CompletedState from './CompletedState';
import InitializingState from './InitializingState';
import InstructionAccordion from './InstructionAccordion';
import ProcessingState from './ProcessingState';

interface ClientTaskDetailProps {
  /** Agent ID from the task message (use task's agentId, not activeAgentId) */
  agentId?: string;
  content?: string;
  /** Group ID from the task message (use task's groupId, not activeGroupId) */
  groupId?: string;
  messageId: string;
  taskDetail?: TaskDetail;
}

const ClientTaskDetail = memo<ClientTaskDetailProps>(({ agentId: propAgentId, groupId, taskDetail }) => {
  const threadId = taskDetail?.threadId;
  const isExecuting = taskDetail?.status === ThreadStatus.Processing;

  // Use task message's agentId to query with the correct SubAgent ID that created the thread
  // Fall back to activeAgentId if task message doesn't have agentId (shouldn't happen normally)
  const [activeAgentId, activeTopicId, useFetchMessages] = useChatStore((s) => [
    s.activeAgentId,
    s.activeTopicId,
    s.useFetchMessages,
  ]);

  const agentId = propAgentId || activeAgentId;

  const threadContext = useMemo(
    () => ({
      agentId,
      groupId,
      scope: 'thread' as const,
      threadId,
      topicId: activeTopicId,
    }),
    [agentId, groupId, activeTopicId, threadId],
  );

  const threadMessageKey = useMemo(
    () => (threadId ? messageMapKey(threadContext) : null),
    [threadId],
  );

  // Fetch thread messages (skip when executing - messages come from real-time updates)
  useFetchMessages(threadContext, isExecuting);

  // Get thread messages from store using selector
  const threadMessages = useChatStore((s) =>
    threadMessageKey
      ? displayMessageSelectors.getDisplayMessagesByKey(threadMessageKey)(s)
      : undefined,
  );

  if (!threadMessages) return <BubblesLoading />;

  // Find the assistantGroup message which contains the children blocks
  const assistantGroupMessage = threadMessages.find((item) => item.role === 'assistantGroup');
  const instruction = threadMessages.find((item) => item.role === 'user')?.content;
  const childrenCount = assistantGroupMessage?.children?.length ?? 0;

  // Get model/provider from assistantGroup message
  const model = assistantGroupMessage?.model;
  const provider = assistantGroupMessage?.provider;

  // Initializing state: no status yet (task just created, waiting for client execution)
  if (threadMessages.length === 0 || !assistantGroupMessage?.children || childrenCount === 0) {
    return <InitializingState />;
  }

  return (
    <Flexbox gap={4}>
      {instruction && (
        <InstructionAccordion childrenCount={childrenCount} instruction={instruction} />
      )}

      {isExecuting ? (
        <ProcessingState
          assistantId={assistantGroupMessage.id}
          blocks={assistantGroupMessage.children}
          model={model ?? undefined}
          provider={provider ?? undefined}
          startTime={assistantGroupMessage.createdAt}
        />
      ) : (
        <CompletedState
          assistantId={assistantGroupMessage.id}
          blocks={assistantGroupMessage.children}
          duration={taskDetail?.duration}
          model={model ?? undefined}
          provider={provider ?? undefined}
          totalCost={taskDetail?.totalCost}
          totalTokens={taskDetail?.totalTokens}
          totalToolCalls={taskDetail?.totalToolCalls}
        />
      )}
    </Flexbox>
  );
});

ClientTaskDetail.displayName = 'ClientClientTaskDetail';

export default ClientTaskDetail;

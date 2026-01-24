'use client';

import { AccordionItem, Block, Text } from '@lobehub/ui';
import { memo, useMemo, useState } from 'react';

import { useChatStore } from '@/store/chat';
import { displayMessageSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { ThreadStatus } from '@/types/index';
import type { UIChatMessage } from '@/types/index';

import ClientTaskDetailCompletedState from '../../Task/ClientTaskDetail/CompletedState';
import ClientTaskDetailProcessingState from '../../Task/ClientTaskDetail/ProcessingState';
import { ErrorState, InitializingState, isProcessingStatus } from '../shared';
import TaskTitle, { type TaskMetrics } from './TaskTitle';

interface ClientTaskItemProps {
  item: UIChatMessage;
}

const ClientTaskItem = memo<ClientTaskItemProps>(({ item }) => {
  const { id, metadata, taskDetail } = item;
  const [expanded, setExpanded] = useState(false);

  const title = taskDetail?.title || metadata?.taskTitle;
  const instruction = metadata?.instruction;
  const status = taskDetail?.status;
  const threadId = taskDetail?.threadId;

  const isProcessing = isProcessingStatus(status);
  const isCompleted = status === ThreadStatus.Completed;
  const isError = status === ThreadStatus.Failed || status === ThreadStatus.Cancel;
  const isInitializing = !taskDetail || !status;

  // Fetch thread messages for client mode (like Task/ClientTaskDetail)
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
    [threadId, threadContext],
  );

  // Fetch thread messages (skip when executing - messages come from real-time updates)
  useFetchMessages(threadContext, isProcessing);

  // Get thread messages from store using selector
  const threadMessages = useChatStore((s) =>
    threadMessageKey
      ? displayMessageSelectors.getDisplayMessagesByKey(threadMessageKey)(s)
      : undefined,
  );

  // Find the assistantGroup message which contains the children blocks
  const assistantGroupMessage = threadMessages?.find((item) => item.role === 'assistantGroup');
  const blocks = assistantGroupMessage?.children;
  const childrenCount = blocks?.length ?? 0;

  // Get model/provider from assistantGroup message
  const model = assistantGroupMessage?.model;
  const provider = assistantGroupMessage?.provider;

  // Build metrics for TaskTitle based on blocks data
  const metrics: TaskMetrics | undefined = useMemo(() => {
    if (isProcessing && blocks) {
      const toolCalls = blocks.reduce((sum, block) => sum + (block.tools?.length || 0), 0);
      return {
        isLoading: false,
        startTime: assistantGroupMessage?.createdAt,
        steps: blocks.length,
        toolCalls,
      };
    }
    if (isCompleted || isError) {
      return {
        duration: taskDetail?.duration,
        steps: taskDetail?.totalSteps,
        toolCalls: taskDetail?.totalToolCalls,
      };
    }
    return undefined;
  }, [
    isProcessing,
    isCompleted,
    isError,
    blocks,
    assistantGroupMessage?.createdAt,
    taskDetail?.duration,
    taskDetail?.totalSteps,
    taskDetail?.totalToolCalls,
  ]);

  // Check if we have blocks to show (for Processing and Completed states)
  const hasBlocks = blocks && childrenCount > 0;

  return (
    <AccordionItem
      expand={expanded}
      itemKey={id}
      onExpandChange={setExpanded}
      paddingBlock={4}
      paddingInline={4}
      title={<TaskTitle metrics={metrics} status={status} title={title} />}
    >
      <Block gap={16} padding={12} style={{ marginBlock: 8 }} variant={'outlined'}>
        {instruction && (
          <Block padding={12}>
            <Text fontSize={13} type={'secondary'}>
              {instruction}
            </Text>
          </Block>
        )}

        {/* Initializing State - no taskDetail yet or no blocks */}
        {(isInitializing || (isProcessing && !hasBlocks)) && <InitializingState />}

        {/* Processing State - show streaming blocks */}
        {!isInitializing && isProcessing && hasBlocks && (
          <ClientTaskDetailProcessingState
            assistantId={assistantGroupMessage!.id}
            blocks={blocks!}
            model={model ?? undefined}
            provider={provider ?? undefined}
            startTime={assistantGroupMessage?.createdAt}
          />
        )}

        {/* Error State */}
        {!isInitializing && isError && taskDetail && <ErrorState taskDetail={taskDetail} />}

        {/* Completed State - show blocks with final result */}
        {!isInitializing && isCompleted && taskDetail && hasBlocks && (
          <ClientTaskDetailCompletedState
            assistantId={assistantGroupMessage!.id}
            blocks={blocks!}
            duration={taskDetail.duration}
            model={model ?? undefined}
            provider={provider ?? undefined}
            totalCost={taskDetail.totalCost}
            totalTokens={taskDetail.totalTokens}
            totalToolCalls={taskDetail.totalToolCalls}
          />
        )}
      </Block>
    </AccordionItem>
  );
}, Object.is);

ClientTaskItem.displayName = 'ClientTaskItem';

export default ClientTaskItem;

'use client';

import { ThreadStatus } from '@lobechat/types';
import type { UIChatMessage } from '@lobechat/types';
import { AccordionItem, Block } from '@lobehub/ui';
import { memo, useMemo, useState } from 'react';

import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useChatStore } from '@/store/chat';

import {
  ErrorState,
  InitializingState,
  TaskMessages,
  isProcessingStatus,
} from '../../Tasks/shared';
import TaskTitle, { type TaskMetrics } from './TaskTitle';

interface ServerTaskItemProps {
  item: UIChatMessage;
}

const ServerTaskItem = memo<ServerTaskItemProps>(({ item }) => {
  const { id, agentId, metadata, taskDetail } = item;
  const [expanded, setExpanded] = useState(false);

  const title = taskDetail?.title || metadata?.taskTitle;
  const status = taskDetail?.status;
  const threadId = taskDetail?.threadId;

  const isProcessing = isProcessingStatus(status);
  const isCompleted = status === ThreadStatus.Completed;
  const isError = status === ThreadStatus.Failed || status === ThreadStatus.Cancel;

  // Get agent info from store
  const activeGroupId = useAgentGroupStore(agentGroupSelectors.activeGroupId);
  const agent = useAgentGroupStore((s) =>
    activeGroupId && agentId
      ? agentGroupSelectors.getAgentByIdFromGroup(activeGroupId, agentId)(s)
      : null,
  );

  // Get polling hook - poll for task status to get messages
  const [useEnablePollingTaskStatus, operations] = useChatStore((s) => [
    s.useEnablePollingTaskStatus,
    s.operations,
  ]);

  // Check if exec_async_task is already polling for this message
  const hasActiveOperationPolling = Object.values(operations).some(
    (op) =>
      op.status === 'running' && op.type === 'execAgentRuntime' && op.context?.messageId === id,
  );

  // Enable polling when task has threadId and no active operation is polling
  const shouldPoll = !!threadId && !hasActiveOperationPolling;
  const { data } = useEnablePollingTaskStatus(threadId, id, shouldPoll);

  const messages = data?.messages;

  // Build metrics for TaskTitle (only for completed/error states)
  const metrics: TaskMetrics | undefined = useMemo(() => {
    if (isCompleted || isError) {
      return {
        duration: taskDetail?.duration,
        steps: taskDetail?.totalSteps,
        toolCalls: taskDetail?.totalToolCalls,
      };
    }
    return undefined;
  }, [
    isCompleted,
    isError,
    taskDetail?.duration,
    taskDetail?.totalSteps,
    taskDetail?.totalToolCalls,
  ]);

  // Render content based on state
  const renderContent = () => {
    // Initializing state: no status yet (task just created, waiting for backend)
    if (!status) {
      return <InitializingState />;
    }

    // Has messages - use TaskMessages to render
    if (messages && messages.length > 0) {
      return (
        <>
          <TaskMessages
            duration={taskDetail?.duration}
            isProcessing={isProcessing}
            messages={messages}
            startTime={taskDetail?.startedAt ? new Date(taskDetail.startedAt).getTime() : undefined}
            totalCost={taskDetail?.totalCost}
          />
          {/* Error states: Failed, Cancel */}
          {isError && taskDetail && <ErrorState taskDetail={taskDetail} />}
        </>
      );
    }

    // Still loading messages
    return <InitializingState />;
  };

  return (
    <AccordionItem
      expand={expanded}
      itemKey={id}
      onExpandChange={setExpanded}
      paddingBlock={4}
      paddingInline={4}
      title={
        <TaskTitle
          agent={
            agent
              ? { avatar: agent.avatar || undefined, backgroundColor: agent.backgroundColor }
              : undefined
          }
          metrics={metrics}
          status={status}
          title={title}
        />
      }
    >
      <Block gap={16} padding={12} style={{ marginBlock: 8 }} variant={'outlined'}>
        {renderContent()}
      </Block>
    </AccordionItem>
  );
}, Object.is);

ServerTaskItem.displayName = 'ServerTaskItem';

export default ServerTaskItem;

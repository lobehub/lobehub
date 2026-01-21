'use client';

import { AccordionItem, Block, Text } from '@lobehub/ui';
import { memo, useMemo, useState } from 'react';

import { ThreadStatus } from '@/types/index';
import type { UIChatMessage } from '@/types/index';

import {
  CompletedState,
  ErrorState,
  InitializingState,
  ProcessingState,
  isProcessingStatus,
} from '../shared';
import TaskTitle, { type TaskMetrics } from './TaskTitle';

interface ServerTaskItemProps {
  item: UIChatMessage;
}

const ServerTaskItem = memo<ServerTaskItemProps>(({ item }) => {
  const { id, content, metadata, taskDetail } = item;
  const [expanded, setExpanded] = useState(false);

  const title = taskDetail?.title || metadata?.taskTitle;
  const instruction = metadata?.instruction;
  const status = taskDetail?.status;

  const isProcessing = isProcessingStatus(status);
  const isCompleted = status === ThreadStatus.Completed;
  const isError = status === ThreadStatus.Failed || status === ThreadStatus.Cancel;
  const isInitializing = !taskDetail || !status;

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
  }, [isCompleted, isError, taskDetail?.duration, taskDetail?.totalSteps, taskDetail?.totalToolCalls]);

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

        {/* Initializing State - no taskDetail yet */}
        {isInitializing && <InitializingState />}

        {/* Processing State */}
        {!isInitializing && isProcessing && taskDetail && (
          <ProcessingState messageId={id} taskDetail={taskDetail} variant="compact" />
        )}

        {/* Error State */}
        {!isInitializing && isError && taskDetail && <ErrorState taskDetail={taskDetail} />}

        {/* Completed State */}
        {!isInitializing && isCompleted && taskDetail && (
          <CompletedState
            content={content}
            expanded={expanded}
            taskDetail={taskDetail}
            variant="compact"
          />
        )}
      </Block>
    </AccordionItem>
  );
}, Object.is);

ServerTaskItem.displayName = 'ServerTaskItem';

export default ServerTaskItem;

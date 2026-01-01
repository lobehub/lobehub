'use client';

import { AccordionItem, Block, Text } from '@lobehub/ui';
import { memo, useState } from 'react';

import { ThreadStatus } from '@/types/index';
import type { UIChatMessage } from '@/types/index';

import {
  CompletedState,
  ErrorState,
  InitializingState,
  ProcessingState,
  isProcessingStatus,
} from '../shared';
import TaskTitle from './TaskTitle';

interface TaskItemProps {
  item: UIChatMessage;
}

const TaskItem = memo<TaskItemProps>(({ item }) => {
  const { id, content, metadata, taskDetail } = item;
  const [expanded, setExpanded] = useState(false);

  const title = taskDetail?.title || metadata?.taskTitle;
  const instruction = metadata?.instruction;
  const status = taskDetail?.status;

  // Check if task is processing using shared utility
  const isProcessing = isProcessingStatus(status);

  const isCompleted = status === ThreadStatus.Completed;
  const isError = status === ThreadStatus.Failed || status === ThreadStatus.Cancel;
  const isInitializing = !taskDetail || !status;

  return (
    <AccordionItem
      expand={expanded}
      itemKey={id}
      onExpandChange={setExpanded}
      paddingBlock={4}
      paddingInline={4}
      title={<TaskTitle status={status} title={title} />}
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

TaskItem.displayName = 'TaskItem';

export default TaskItem;

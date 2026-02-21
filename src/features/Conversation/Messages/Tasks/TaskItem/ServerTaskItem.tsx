'use client';

import { AccordionItem, Block } from '@lobehub/ui';
import { memo, useMemo, useState } from 'react';

import { type UIChatMessage } from '@/types/index';
import { ThreadStatus } from '@/types/index';

import { TaskContent } from '../shared';
import { type TaskMetrics } from './TaskTitle';
import TaskTitle from './TaskTitle';

interface ServerTaskItemProps {
  item: UIChatMessage;
}

const ServerTaskItem = memo<ServerTaskItemProps>(({ item }) => {
  const { id, metadata, taskDetail, tasks } = item;
  const [expanded, setExpanded] = useState(false);

  const title = taskDetail?.title || metadata?.taskTitle;
  const status = taskDetail?.status;
  const threadId = taskDetail?.threadId;

  const isCompleted = status === ThreadStatus.Completed;
  const isError = status === ThreadStatus.Failed || status === ThreadStatus.Cancel;

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

  return (
    <AccordionItem
      expand={expanded}
      itemKey={id}
      paddingBlock={4}
      paddingInline={4}
      title={<TaskTitle metrics={metrics} status={status} title={title} />}
      onExpandChange={setExpanded}
    >
      <Block gap={16} padding={12} style={{ marginBlock: 8 }} variant={'outlined'}>
        {expanded && (
          <TaskContent
            id={id}
            isError={isError}
            messages={tasks}
            status={status}
            taskDetail={taskDetail}
            threadId={threadId}
          />
        )}
      </Block>
    </AccordionItem>
  );
}, Object.is);

ServerTaskItem.displayName = 'ServerTaskItem';

export default ServerTaskItem;

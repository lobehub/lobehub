'use client';

import { type UIChatMessage } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import ClientTaskItem from './ClientTaskItem';
import ServerTaskItem from './ServerTaskItem';

interface TaskItemProps {
  item: UIChatMessage;
}

const TaskItem = memo<TaskItemProps>(({ item }) => {
  const isClientMode = item.taskDetail?.clientMode;

  if (isClientMode) {
    return <ClientTaskItem item={item} />;
  }

  return <ServerTaskItem item={item} />;
}, isEqual);

TaskItem.displayName = 'TaskItem';

export default TaskItem;

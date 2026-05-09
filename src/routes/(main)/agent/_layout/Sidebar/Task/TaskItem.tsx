'use client';

import { Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import NavItem from '@/features/NavPanel/components/NavItem';
import type { TaskGroupItem } from '@/store/task/slices/list/initialState';

type TaskRow = TaskGroupItem['tasks'][number];

interface TaskItemProps {
  active?: boolean;
  task: TaskRow;
}

const TaskItem = memo<TaskItemProps>(({ task, active }) => {
  const navigate = useNavigate();

  const handleClick = useCallback(() => {
    navigate(`/task/${task.identifier}`);
  }, [navigate, task.identifier]);

  const hasName = Boolean(task.name?.trim());
  const displayTitle = hasName ? task.name : task.identifier;

  return (
    <NavItem
      active={active}
      title={displayTitle}
      slots={{
        titlePrefix: hasName ? (
          <Text fontSize={12} style={{ color: cssVar.colorTextTertiary, flex: 'none' }}>
            {task.identifier}
          </Text>
        ) : undefined,
      }}
      onClick={handleClick}
    />
  );
});

export default TaskItem;

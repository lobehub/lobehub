import type { TaskDetailSubtask } from '@lobechat/types';
import { type DropdownMenuProps } from '@lobehub/ui';
import { Block, DropdownMenu, Flexbox, Text } from '@lobehub/ui';
import { Progress } from 'antd';
import { cssVar } from 'antd-style';
import { memo, useMemo } from 'react';

import TaskStatusIcon from './TaskStatusIcon';

type TaskStatus = 'backlog' | 'canceled' | 'completed' | 'failed' | 'paused' | 'running';

const TASK_STATUS_SET = new Set([
  'backlog',
  'canceled',
  'completed',
  'failed',
  'paused',
  'running',
]);

const toTaskStatus = (status: string): TaskStatus =>
  TASK_STATUS_SET.has(status) ? (status as TaskStatus) : 'backlog';

interface FlattenedSubtask {
  depth: number;
  task: TaskDetailSubtask;
}

const flattenSubtasks = (nodes: TaskDetailSubtask[]) => {
  if (nodes.some((node) => Boolean(node.children?.length))) {
    const list: FlattenedSubtask[] = [];

    const walk = (items: TaskDetailSubtask[], depth: number) => {
      for (const item of items) {
        list.push({ depth, task: item });
        if (item.children && item.children.length > 0) {
          walk(item.children, depth + 1);
        }
      }
    };

    walk(nodes, 0);
    return list;
  }

  const taskMap = new Map(nodes.map((item) => [item.identifier, item]));
  const depthMemo = new Map<string, number>();

  const getDepth = (identifier: string, stack: Set<string>): number => {
    const cached = depthMemo.get(identifier);
    if (cached !== undefined) return cached;

    if (stack.has(identifier)) return 0;

    const node = taskMap.get(identifier);
    const parentIdentifier = node?.blockedBy;
    if (!node || !parentIdentifier || !taskMap.has(parentIdentifier)) {
      depthMemo.set(identifier, 0);
      return 0;
    }

    stack.add(identifier);
    const depth = getDepth(parentIdentifier, stack) + 1;
    stack.delete(identifier);

    depthMemo.set(identifier, depth);
    return depth;
  };

  return nodes.map((task) => ({
    depth: getDepth(task.identifier, new Set<string>()),
    task,
  }));
};

interface TaskSubtaskProgressTagProps {
  currentIdentifier?: string;
  onSubtaskClick?: (identifier: string) => void;
  subtasks?: TaskDetailSubtask[];
}

const TaskSubtaskProgressTag = memo<TaskSubtaskProgressTagProps>(
  ({ subtasks, currentIdentifier, onSubtaskClick }) => {
    const flattenedSubtasks = useMemo(() => {
      if (!subtasks || subtasks.length === 0) return [];
      return flattenSubtasks(subtasks);
    }, [subtasks]);

    const data = useMemo(() => {
      if (flattenedSubtasks.length === 0) return undefined;

      const total = flattenedSubtasks.length;
      const completed = flattenedSubtasks.filter((item) => item.task.status === 'completed').length;
      if (total === 0) return undefined;

      return {
        text: `${completed}/${total}`,
        percent: (completed / total) * 100,
      };
    }, [flattenedSubtasks]);

    if (!data) return null;

    const navigationItems = flattenedSubtasks.map((subtask) => {
      const isActive = subtask.task.identifier === currentIdentifier;
      const itemStatus = toTaskStatus(subtask.task.status);

      return {
        key: subtask.task.identifier,
        label: (
          <Flexbox horizontal align="center" gap={8}>
            {subtask.depth > 0 && <div style={{ flex: 'none', width: subtask.depth * 16 }} />}
            <TaskStatusIcon size={16} status={itemStatus} />
            <Text ellipsis weight={isActive ? 'bold' : undefined}>
              {subtask.task.name || subtask.task.identifier}
            </Text>
          </Flexbox>
        ),
        onClick: () => onSubtaskClick?.(subtask.task.identifier),
      };
    }) as DropdownMenuProps['items'];

    const hasDropdown = Boolean(onSubtaskClick) && navigationItems.length > 0;

    const tag = (
      <Block
        horizontal
        align={'center'}
        gap={4}
        height={24}
        paddingInline={'4px 8px'}
        style={{ borderRadius: 24, cursor: hasDropdown ? 'pointer' : undefined }}
        variant={'outlined'}
        onClick={hasDropdown ? (e) => e.stopPropagation() : undefined}
      >
        <Progress
          percent={data.percent}
          showInfo={false}
          size={16}
          strokeColor={cssVar.colorSuccess}
          type={'circle'}
        />
        <Text fontSize={12} type={'secondary'}>
          {data.text}
        </Text>
      </Block>
    );

    if (!hasDropdown) return tag;

    return (
      <DropdownMenu items={navigationItems} trigger={'both'}>
        {tag}
      </DropdownMenu>
    );
  },
);

export default TaskSubtaskProgressTag;

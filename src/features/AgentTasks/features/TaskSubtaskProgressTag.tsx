import type { TaskDetailSubtask, TaskSubtaskProgress } from '@lobechat/types';
import { Block, Flexbox } from '@lobehub/ui';
import type { DropdownMenuProps } from '@lobehub/ui/base-ui';
import { DropdownMenu, Text, toast } from '@lobehub/ui/base-ui';
import { Progress } from 'antd';
import { cssVar } from 'antd-style';
import type { MouseEvent } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  onRequestSubtasks?: () => Promise<TaskDetailSubtask[]>;
  onSubtaskClick?: (identifier: string, assigneeAgentId?: string) => void;
  progress?: TaskSubtaskProgress;
  subtasks?: TaskDetailSubtask[];
}

const TaskSubtaskProgressTag = memo<TaskSubtaskProgressTagProps>(
  ({ subtasks, currentIdentifier, onRequestSubtasks, onSubtaskClick, progress }) => {
    const { t } = useTranslation('chat');
    const [open, setOpen] = useState(false);
    const [refreshedResult, setRefreshedResult] = useState<{
      sourceIdentifier: string | undefined;
      sourceProgress: TaskSubtaskProgress | undefined;
      subtasks: TaskDetailSubtask[];
    }>();
    const [requesting, setRequesting] = useState(false);
    const refreshedSubtasks =
      refreshedResult &&
      refreshedResult.sourceIdentifier === currentIdentifier &&
      refreshedResult.sourceProgress === progress
        ? refreshedResult.subtasks
        : undefined;
    const flattenedSubtasks = useMemo(() => {
      const effectiveSubtasks = refreshedSubtasks ?? subtasks;
      if (!effectiveSubtasks || effectiveSubtasks.length === 0) return [];
      return flattenSubtasks(effectiveSubtasks);
    }, [refreshedSubtasks, subtasks]);

    const data = useMemo(() => {
      // Before interaction, the list summary is newer than a possibly cached
      // detail tree. After an on-demand refresh, its result is the fresh source
      // of truth until a later list response changes the summary.
      const effectiveProgress = refreshedSubtasks === undefined ? progress : undefined;
      const total = effectiveProgress?.total ?? flattenedSubtasks.length;
      if (total === 0) return undefined;

      const completed =
        effectiveProgress !== undefined
          ? effectiveProgress.completed
          : flattenedSubtasks.length > 0
            ? flattenedSubtasks.filter((item) => item.task.status === 'completed').length
            : 0;

      return {
        text: `${completed}/${total}`,
        percent: (completed / total) * 100,
      };
    }, [flattenedSubtasks, progress, refreshedSubtasks]);

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
        onClick: () =>
          onSubtaskClick?.(subtask.task.identifier, subtask.task.assignee?.id ?? undefined),
      };
    }) as DropdownMenuProps['items'];

    const hasDropdown = Boolean(onSubtaskClick) && navigationItems.length > 0;

    const handleTagClick = useCallback(
      async (event: MouseEvent<HTMLElement>) => {
        event.stopPropagation();

        if (open) {
          setOpen(false);
          return;
        }

        if (!onRequestSubtasks || requesting) return;

        setRequesting(true);
        try {
          const nextSubtasks = await onRequestSubtasks();
          setRefreshedResult({
            sourceIdentifier: currentIdentifier,
            sourceProgress: progress,
            subtasks: nextSubtasks,
          });
          setOpen(nextSubtasks.length > 0);
        } catch (error) {
          console.error('Failed to load task subtasks:', error);
          toast.error(t('taskList.subtaskProgress.loadFailed'));
        } finally {
          setRequesting(false);
        }
      },
      [currentIdentifier, onRequestSubtasks, open, progress, requesting, t],
    );

    const handleOpenChange = useCallback(
      (nextOpen: boolean) => {
        // List rows own an async refresh step and open only after it succeeds.
        // Static detail-only menus can keep the dropdown's native behavior.
        if (!nextOpen || !onRequestSubtasks) setOpen(nextOpen);
      },
      [onRequestSubtasks],
    );

    if (!data) return null;

    const tag = (
      <Block
        horizontal
        align={'center'}
        gap={4}
        height={24}
        paddingInline={'4px 8px'}
        variant={'outlined'}
        style={{
          borderRadius: 24,
          cursor: hasDropdown || onRequestSubtasks ? 'pointer' : undefined,
        }}
        onClick={hasDropdown || onRequestSubtasks ? handleTagClick : undefined}
        onContextMenu={onRequestSubtasks ? handleTagClick : undefined}
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
      <DropdownMenu
        items={navigationItems}
        open={open}
        trigger={'both'}
        onOpenChange={handleOpenChange}
      >
        {tag}
      </DropdownMenu>
    );
  },
);

export default TaskSubtaskProgressTag;

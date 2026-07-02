import type { TaskStatus } from '@lobechat/types';
import { Block, ContextMenuTrigger, Flexbox, Text } from '@lobehub/ui';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useTaskStore } from '@/store/task';
import type { TaskListItem } from '@/store/task/slices/list/initialState';

import { taskDetailPath } from '../shared/taskDetailPath';
import AssigneeAgentSelector from './AssigneeAgentSelector';
import AssigneeAvatar from './AssigneeAvatar';
import { formatTaskItemDate } from './formatTaskItemDate';
import TaskLatestActivity from './TaskLatestActivity';
import TaskPriorityTag from './TaskPriorityTag';
import TaskStatusTag from './TaskStatusTag';
import TaskSubtaskProgressTag from './TaskSubtaskProgressTag';
import TaskTriggerTag from './TaskTriggerTag';
import { useTaskItemContextMenu } from './useTaskItemContextMenu';

export type TaskItemRouteScope = 'agent' | 'global';

interface TaskItemProps {
  routeScope?: TaskItemRouteScope;
  task: TaskListItem;
  variant?: 'compact' | 'default';
}

const FLEX_MIN_WIDTH_0 = { minWidth: 0 };

const TASK_STATUS_SET = new Set<TaskStatus>([
  'backlog',
  'canceled',
  'completed',
  'failed',
  'paused',
  'running',
  'scheduled',
]);

const toTaskStatus = (status: string): TaskStatus =>
  TASK_STATUS_SET.has(status as TaskStatus) ? (status as TaskStatus) : 'backlog';

const AgentTaskItem = memo<TaskItemProps>(({ task, routeScope = 'agent', variant = 'default' }) => {
  const { t, i18n } = useTranslation('common');
  const { t: tChat } = useTranslation('chat');
  const useFetchTaskDetail = useTaskStore((s) => s.useFetchTaskDetail);
  useFetchTaskDetail(task.identifier);

  const taskDetail = useTaskStore((s) => s.taskDetailMap[task.identifier]);
  const { items: contextMenuItems, onContextMenu: handleContextMenuOpen } = useTaskItemContextMenu(
    task,
    routeScope,
  );
  const navigate = useWorkspaceAwareNavigate();

  const time = formatTaskItemDate(task.updatedAt || task.createdAt, {
    formatOtherYear: t('time.formatOtherYear'),
    formatThisYear: t('time.formatThisYear'),
    locale: i18n.language,
  });
  const status = toTaskStatus(task.status);
  const hasName = Boolean(task.name?.trim());

  const handleClick = useCallback(() => {
    navigate(
      taskDetailPath(
        task.identifier,
        routeScope === 'agent' ? (task.assigneeAgentId ?? undefined) : undefined,
      ),
    );
  }, [navigate, routeScope, task.assigneeAgentId, task.identifier]);

  const handleSubtaskClick = useCallback(
    (identifier: string, assigneeAgentId?: string) => {
      navigate(taskDetailPath(identifier, routeScope === 'agent' ? assigneeAgentId : undefined));
    },
    [navigate, routeScope],
  );

  const scheduledBadge =
    status === 'scheduled' ? (
      <Block
        horizontal
        align={'center'}
        flex={'none'}
        height={20}
        paddingInline={8}
        style={{ borderRadius: 24 }}
        variant={'outlined'}
      >
        <Text fontSize={12} type={'secondary'}>
          {tChat('taskDetail.status.scheduled', { defaultValue: 'Scheduled' })}
        </Text>
      </Block>
    ) : null;

  const titleRow = (
    <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
      <TaskPriorityTag priority={task.priority} taskIdentifier={task.identifier} />
      <TaskStatusTag status={status} taskIdentifier={task.identifier} />
      {hasName ? (
        <>
          <Text style={{ flex: 'none' }} type={'secondary'}>
            {task.identifier}
          </Text>
          <Text ellipsis style={{ minWidth: 0 }} weight={500}>
            {task.name}
          </Text>
        </>
      ) : (
        <Text ellipsis style={{ minWidth: 0 }} weight={500}>
          {task.identifier}
        </Text>
      )}
      {scheduledBadge}
      <TaskSubtaskProgressTag
        currentIdentifier={task.identifier}
        subtasks={taskDetail?.subtasks}
        onSubtaskClick={handleSubtaskClick}
      />
    </Flexbox>
  );

  const assigneeNode = (
    <AssigneeAgentSelector
      currentAgentId={task.assigneeAgentId}
      disabled={status === 'running'}
      taskIdentifier={task.identifier}
    >
      <AssigneeAvatar agentId={task.assigneeAgentId} />
    </AssigneeAgentSelector>
  );

  const scheduleNode = task.automationMode ? (
    <TaskTriggerTag
      automationMode={task.automationMode}
      heartbeatInterval={taskDetail?.heartbeat?.interval}
      schedulePattern={task.schedulePattern}
      scheduleTimezone={task.scheduleTimezone}
    />
  ) : null;

  const timeNode = time ? (
    <Text
      align={'right'}
      fontSize={12}
      style={{ whiteSpace: 'nowrap', width: variant === 'compact' ? undefined : 48 }}
      type={'secondary'}
    >
      {time}
    </Text>
  ) : null;

  if (variant === 'compact') {
    return (
      <ContextMenuTrigger items={contextMenuItems} onContextMenu={handleContextMenuOpen}>
        <Block clickable gap={8} padding={12} variant={'borderless'} onClick={handleClick}>
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
            <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
              {task.identifier}
            </Text>
            {assigneeNode}
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
            <TaskStatusTag status={status} taskIdentifier={task.identifier} />
            <Text ellipsis style={{ minWidth: 0 }} weight={500}>
              {hasName ? task.name : task.identifier}
            </Text>
            {scheduledBadge}
            <TaskSubtaskProgressTag
              currentIdentifier={task.identifier}
              subtasks={taskDetail?.subtasks}
              onSubtaskClick={handleSubtaskClick}
            />
          </Flexbox>
          <TaskLatestActivity activities={taskDetail?.activities} />
          <Flexbox horizontal align={'center'} gap={8} style={FLEX_MIN_WIDTH_0}>
            <TaskPriorityTag priority={task.priority} taskIdentifier={task.identifier} />
            {scheduleNode}
            {timeNode}
          </Flexbox>
        </Block>
      </ContextMenuTrigger>
    );
  }

  return (
    <ContextMenuTrigger items={contextMenuItems} onContextMenu={handleContextMenuOpen}>
      <Block clickable gap={4} padding={12} variant={'borderless'} onClick={handleClick}>
        <Flexbox horizontal align={'center'} gap={4} justify={'space-between'}>
          {titleRow}
          <Flexbox horizontal align={'center'} flex={'none'} gap={8}>
            {scheduleNode}
            {assigneeNode}
            {timeNode}
          </Flexbox>
        </Flexbox>
        <TaskLatestActivity activities={taskDetail?.activities} />
      </Block>
    </ContextMenuTrigger>
  );
});

export default AgentTaskItem;

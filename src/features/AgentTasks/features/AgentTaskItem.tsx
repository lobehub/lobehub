import { Block, ContextMenuTrigger, Flexbox, Text } from '@lobehub/ui';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useTaskStore } from '@/store/task';
import type { TaskListItem } from '@/store/task/slices/list/initialState';

import TaskScheduleConfig from '../AgentTaskDetail/TaskScheduleConfig';
import AssigneeAgentSelector from './AssigneeAgentSelector';
import AssigneeAvatar from './AssigneeAvatar';
import { formatTaskItemDate } from './formatTaskItemDate';
import TaskLatestActivity from './TaskLatestActivity';
import TaskPriorityTag from './TaskPriorityTag';
import TaskStatusTag from './TaskStatusTag';
import TaskSubtaskProgressTag from './TaskSubtaskProgressTag';
import TaskTriggerTag from './TaskTriggerTag';
import { useTaskItemContextMenu } from './useTaskItemContextMenu';

interface TaskItemProps {
  task: TaskListItem;
  variant?: 'compact' | 'default';
}

const TASK_STATUS_SET = new Set([
  'backlog',
  'canceled',
  'completed',
  'failed',
  'paused',
  'running',
]);

type TaskStatus = 'backlog' | 'canceled' | 'completed' | 'failed' | 'paused' | 'running';

const toTaskStatus = (status: string): TaskStatus =>
  TASK_STATUS_SET.has(status) ? (status as TaskStatus) : 'backlog';

const AgentTaskItem = memo<TaskItemProps>(({ task, variant = 'default' }) => {
  const { t } = useTranslation('discover');
  const useFetchTaskDetail = useTaskStore((s) => s.useFetchTaskDetail);
  useFetchTaskDetail(task.identifier);

  const taskDetail = useTaskStore((s) => s.taskDetailMap[task.identifier]);
  const { items: contextMenuItems, onContextMenu: handleContextMenuOpen } =
    useTaskItemContextMenu(task);
  const navigate = useNavigate();

  const time = formatTaskItemDate(task.updatedAt || task.createdAt, {
    formatOtherYear: t('time.formatOtherYear'),
    formatThisYear: t('time.formatThisYear'),
  });
  const status = toTaskStatus(task.status);
  const hasName = Boolean(task.name?.trim());

  const handleClick = useCallback(() => {
    navigate(`/task/${task.identifier}`);
  }, [navigate, task.identifier]);

  const handleSubtaskClick = useCallback(
    (identifier: string) => {
      navigate(`/task/${identifier}`);
    },
    [navigate],
  );

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
    <TaskScheduleConfig
      currentInterval={taskDetail?.heartbeat?.interval ?? 0}
      taskId={task.identifier}
    >
      <TaskTriggerTag
        heartbeatInterval={taskDetail?.heartbeat?.interval}
        schedulePattern={task.schedulePattern}
        scheduleTimezone={task.scheduleTimezone}
      />
    </TaskScheduleConfig>
  ) : null;

  const timeNode = time ? (
    <Text
      align={'right'}
      fontSize={12}
      style={{ whiteSpace: 'nowrap', width: variant === 'compact' ? undefined : 76 }}
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
            <TaskSubtaskProgressTag
              currentIdentifier={task.identifier}
              subtasks={taskDetail?.subtasks}
              onSubtaskClick={handleSubtaskClick}
            />
          </Flexbox>
          <TaskLatestActivity activities={taskDetail?.activities} />
          <Flexbox horizontal align={'center'} gap={8}>
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

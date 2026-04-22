import { Block, Flexbox, Text } from '@lobehub/ui';
import dayjs from 'dayjs';
import { memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAgentStore } from '@/store/agent';
import { useTaskStore } from '@/store/task';
import type { TaskListItem } from '@/store/task/slices/list/initialState';

import TaskScheduleConfig from '../AgentTaskDetail/TaskScheduleConfig';
import AssigneeAgentSelector from './AssigneeAgentSelector';
import AssigneeAvatar from './AssigneeAvatar';
import TaskLatestActivity from './TaskLatestActivity';
import TaskPriorityTag from './TaskPriorityTag';
import TaskStatusTag from './TaskStatusTag';
import TaskSubtaskProgressTag from './TaskSubtaskProgressTag';
import TaskTriggerTag from './TaskTriggerTag';

interface TaskItemProps {
  task: TaskListItem;
}

const formatTime = (time?: string | Date | null) => {
  if (!time) return '';
  const d = dayjs(time);
  return d.isSame(dayjs(), 'day') ? d.format('HH:mm') : d.fromNow();
};

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

const AgentTaskItem = memo<TaskItemProps>(({ task }) => {
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const useFetchTaskDetail = useTaskStore((s) => s.useFetchTaskDetail);
  useFetchTaskDetail(task.identifier);

  const taskDetail = useTaskStore((s) => s.taskDetailMap[task.identifier]);
  const navigate = useNavigate();

  const time = formatTime(task.updatedAt || task.createdAt);
  const status = toTaskStatus(task.status);

  // Prefer the task's own assignee so navigation works from the cross-agent `/tasks` page
  // where `activeAgentId` is not scoped to any particular agent. Falls back to the
  // currently active agent for unassigned tasks viewed from a per-agent page.
  const targetAgentId = task.assigneeAgentId || activeAgentId;

  const handleClick = useCallback(() => {
    if (targetAgentId) navigate(`/agent/${targetAgentId}/tasks/${task.identifier}`);
  }, [targetAgentId, navigate, task.identifier]);

  return (
    <Block clickable gap={4} padding={12} variant={'borderless'} onClick={handleClick}>
      <Flexbox horizontal align={'center'} gap={4} justify={'space-between'}>
        <Flexbox horizontal align="center" gap={8}>
          <TaskPriorityTag priority={task.priority} taskIdentifier={task.identifier} />
          <TaskStatusTag status={status} taskIdentifier={task.identifier} />
          <Text ellipsis weight={500}>
            {task.name || task.identifier}
          </Text>
          <TaskSubtaskProgressTag
            currentIdentifier={task.identifier}
            subtasks={taskDetail?.subtasks}
            onSubtaskClick={(identifier) => {
              if (targetAgentId) navigate(`/agent/${targetAgentId}/tasks/${identifier}`);
            }}
          />
        </Flexbox>
        <Flexbox horizontal align={'center'} flex={'none'} gap={8}>
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
          <AssigneeAgentSelector
            currentAgentId={task.assigneeAgentId}
            disabled={status === 'running'}
            taskIdentifier={task.identifier}
          >
            <AssigneeAvatar agentId={task.assigneeAgentId} />
          </AssigneeAgentSelector>
          {time && (
            <Text
              align={'right'}
              fontSize={12}
              type={'secondary'}
              style={{
                whiteSpace: 'nowrap',
                width: 76,
              }}
            >
              {time}
            </Text>
          )}
        </Flexbox>
      </Flexbox>
      <TaskLatestActivity activities={taskDetail?.activities} />
    </Block>
  );
});

export default AgentTaskItem;

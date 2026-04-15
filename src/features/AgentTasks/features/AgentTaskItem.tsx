import { Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAgentStore } from '@/store/agent';
import { useTaskStore } from '@/store/task';
import type { TaskListItem } from '@/store/task/slices/list/initialState';

import AgentAvatars from './AgentAvatars';
import TaskLatestActivity from './TaskLatestActivity';
import TaskPriorityTag from './TaskPriorityTag';
import TaskStatusIcon from './TaskStatusIcon';
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
  const agentId = useAgentStore((s) => s.activeAgentId);
  const useFetchTaskDetail = useTaskStore((s) => s.useFetchTaskDetail);
  useFetchTaskDetail(task.identifier);

  const taskDetail = useTaskStore((s) => s.taskDetailMap[task.identifier]);
  const navigate = useNavigate();

  const time = formatTime(task.updatedAt || task.createdAt);
  const status = toTaskStatus(task.status);

  const handleClick = useCallback(() => {
    if (agentId) navigate(`/agent/${agentId}/tasks/${task.identifier}`);
  }, [agentId, navigate, task.identifier]);

  return (
    <Block clickable gap={4} padding={12} variant={'borderless'} onClick={handleClick}>
      <Flexbox horizontal align={'center'} gap={4} justify={'space-between'}>
        <Flexbox horizontal align="center" gap={8}>
          <TaskPriorityTag priority={task.priority} taskIdentifier={task.identifier} />
          <TaskStatusIcon status={status} />
          <Text ellipsis weight={500}>
            {task.name || task.identifier}
          </Text>
          <TaskSubtaskProgressTag
            currentIdentifier={task.identifier}
            subtasks={taskDetail?.subtasks}
            onSubtaskClick={(identifier) => {
              if (agentId) navigate(`/agent/${agentId}/tasks/${identifier}`);
            }}
          />
        </Flexbox>
        <Flexbox horizontal align={'center'} flex={'none'} gap={8}>
          <TaskTriggerTag
            heartbeatInterval={taskDetail?.heartbeat?.interval}
            schedulePattern={task.schedulePattern}
            scheduleTimezone={task.scheduleTimezone}
          />
          <AgentAvatars agents={task.participants} />
          {time && (
            <span style={{ color: cssVar.colorTextTertiary, fontSize: cssVar.fontSizeSM }}>
              {time}
            </span>
          )}
        </Flexbox>
      </Flexbox>
      <TaskLatestActivity activities={taskDetail?.activities} />
    </Block>
  );
});

export default AgentTaskItem;

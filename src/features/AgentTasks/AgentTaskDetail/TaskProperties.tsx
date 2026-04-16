import type { TaskPriority, TaskStatus } from '@lobechat/types';
import { Block, Text } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { INBOX_SESSION_ID } from '@/const/session';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors, taskListSelectors } from '@/store/task/selectors';

import AgentAvatars from '../features/AgentAvatars';
import TaskPriorityTag from '../features/TaskPriorityTag';
import TaskStatusTag from '../features/TaskStatusTag';
import TaskTriggerTag from '../features/TaskTriggerTag';
import TaskScheduleConfig from './TaskScheduleConfig';

interface StatusMeta {
  labelKey: string;
}

const STATUS_META: Record<TaskStatus, StatusMeta> = {
  backlog: { labelKey: 'status.backlog' },
  canceled: { labelKey: 'status.canceled' },
  completed: { labelKey: 'status.completed' },
  failed: { labelKey: 'status.failed' },
  paused: { labelKey: 'status.paused' },
  running: { labelKey: 'status.running' },
};

interface PriorityMeta {
  labelKey: string;
}

const PRIORITY_META: Record<TaskPriority, PriorityMeta> = {
  0: { labelKey: 'priority.none' },
  1: { labelKey: 'priority.urgent' },
  2: { labelKey: 'priority.high' },
  3: { labelKey: 'priority.normal' },
  4: { labelKey: 'priority.low' },
};

const TaskProperties = memo(() => {
  const { t } = useTranslation(['chat', 'common']);

  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const status = useTaskStore(taskDetailSelectors.activeTaskStatus) as TaskStatus | undefined;
  const priority = useTaskStore(taskDetailSelectors.activeTaskPriority);
  const heartbeatInterval = useTaskStore(taskDetailSelectors.activeTaskPeriodicInterval);
  const taskList = useTaskStore(taskListSelectors.taskList);

  const participants = useMemo(
    () => taskList.find((task) => task.identifier === taskId)?.participants ?? [],
    [taskId, taskList],
  );
  const firstParticipant = participants[0];
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const firstParticipantMeta = useAgentStore(
    agentSelectors.getAgentMetaById(firstParticipant?.id || ''),
  );
  const isInboxParticipant =
    firstParticipant?.id === INBOX_SESSION_ID ||
    (!!inboxAgentId && firstParticipant?.id === inboxAgentId);
  const firstParticipantName =
    firstParticipantMeta?.title?.trim() ||
    firstParticipant?.title ||
    (isInboxParticipant ? t('inbox.title') : t('defaultSession', { ns: 'common' }));
  const restCount = Math.max(participants.length - 1, 0);
  const participantLabel =
    participants.length <= 1 ? firstParticipantName : `${firstParticipantName} (+${restCount})`;

  if (!taskId) return null;

  const statusMeta = status ? STATUS_META[status] : STATUS_META.backlog;
  const priorityMeta = PRIORITY_META[priority as TaskPriority] ?? PRIORITY_META[0];

  return (
    <Block gap={4} padding={4} variant={'outlined'} width={200}>
      <TaskStatusTag status={status} taskIdentifier={taskId}>
        <Block
          clickable
          horizontal
          align="center"
          gap={10}
          paddingBlock={4}
          paddingInline={8}
          variant={'borderless'}
        >
          <TaskStatusTag disableDropdown size={16} status={status} taskIdentifier={taskId} />
          <Text weight={500}>{t(`taskDetail.${statusMeta.labelKey}` as never)}</Text>
        </Block>
      </TaskStatusTag>

      <TaskPriorityTag priority={priority} taskIdentifier={taskId}>
        <Block
          clickable
          horizontal
          align="center"
          gap={10}
          paddingBlock={4}
          paddingInline={8}
          variant={'borderless'}
        >
          <TaskPriorityTag disableDropdown priority={priority} size={16} taskIdentifier={taskId} />
          <Text weight={500}>{t(`taskDetail.${priorityMeta.labelKey}` as never)}</Text>
        </Block>
      </TaskPriorityTag>

      <TaskScheduleConfig>
        <Block
          clickable
          horizontal
          align="center"
          gap={10}
          paddingBlock={4}
          paddingInline={8}
          variant={'borderless'}
        >
          <TaskTriggerTag heartbeatInterval={heartbeatInterval} mode="inline" />
        </Block>
      </TaskScheduleConfig>

      {participants.length > 0 && (
        <Block
          horizontal
          align="center"
          gap={8}
          paddingBlock={4}
          paddingInline={'6px 8px'}
          variant={'borderless'}
        >
          <AgentAvatars agents={participants} size={20} />
          <Text weight={500}>{participantLabel}</Text>
        </Block>
      )}
    </Block>
  );
});

export default TaskProperties;

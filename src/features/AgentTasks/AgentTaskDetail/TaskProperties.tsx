import type { TaskPriority, TaskStatus } from '@lobechat/types';
import { Block } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import AssigneeMemberSelector from '../features/AssigneeMemberSelector';
import AssigneeUserAvatar from '../features/AssigneeUserAvatar';
import TaskPriorityTag from '../features/TaskPriorityTag';
import TaskStatusTag from '../features/TaskStatusTag';
import TaskTriggerTag from '../features/TaskTriggerTag';
import { UnassignedAssigneeIcon } from '../features/UnassignedAssigneeIcon';
import { shouldShowMemberAssignee } from '../shared/memberAssigneeMode';
import { useUserDisplayMeta } from '../shared/useUserDisplayMeta';
import TaskAcceptanceStateRow from './TaskAcceptanceStateRow';
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
  scheduled: { labelKey: 'status.scheduled' },
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
  const assigneeUserId = useTaskStore(taskDetailSelectors.activeTaskAssigneeUserId);
  const createdByUserId = useTaskStore(taskDetailSelectors.activeTaskCreatedByUserId);
  const visibility = useTaskStore(taskDetailSelectors.activeTaskVisibility);
  const heartbeatInterval = useTaskStore(taskDetailSelectors.activeTaskPeriodicInterval);
  const automationMode = useTaskStore(taskDetailSelectors.activeTaskAutomationMode);
  const schedulePattern = useTaskStore(taskDetailSelectors.activeTaskSchedulePattern);
  const scheduleTimezone = useTaskStore(taskDetailSelectors.activeTaskScheduleTimezone);
  const memberMeta = useUserDisplayMeta(assigneeUserId);
  const activeWorkspaceId = useActiveWorkspaceId();

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

      {/* The human layer: whether the delivery is accepted. Read-only here —
          the decision itself is made on the acceptance page this links to. */}
      <TaskAcceptanceStateRow />

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

      {shouldShowMemberAssignee(activeWorkspaceId, assigneeUserId) && (
        <AssigneeMemberSelector
          fullWidth
          currentUserId={assigneeUserId}
          disabled={status === 'running'}
          taskCreatorId={createdByUserId}
          taskIdentifier={taskId}
          taskVisibility={visibility}
        >
          <Block
            clickable
            horizontal
            align="center"
            gap={10}
            paddingBlock={4}
            paddingInline={8}
            variant={'borderless'}
            width={'100%'}
          >
            {assigneeUserId ? (
              <>
                <AssigneeUserAvatar size={16} userId={assigneeUserId} />
                <Text ellipsis style={{ minWidth: 0 }} weight={500}>
                  {memberMeta?.title}
                </Text>
              </>
            ) : (
              <>
                <UnassignedAssigneeIcon kind={'human'} size={16} />
                <Text style={{ color: cssVar.colorTextDescription }} weight={500}>
                  {t('taskDetail.assignee')}
                </Text>
              </>
            )}
          </Block>
        </AssigneeMemberSelector>
      )}

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
          <TaskTriggerTag
            automationMode={automationMode}
            heartbeatInterval={heartbeatInterval}
            mode="inline"
            schedulePattern={schedulePattern}
            scheduleTimezone={scheduleTimezone}
          />
        </Block>
      </TaskScheduleConfig>
    </Block>
  );
});

export default TaskProperties;

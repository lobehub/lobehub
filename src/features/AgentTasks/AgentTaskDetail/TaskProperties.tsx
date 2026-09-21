import type { TaskPriority, TaskStatus } from '@lobechat/types';
import { applyTaskReposSelection, readTaskExecutionConfig } from '@lobechat/types';
import { Block } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { usePermission } from '@/hooks/usePermission';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import AssigneeMemberSelector from '../features/AssigneeMemberSelector';
import AssigneeUserAvatar from '../features/AssigneeUserAvatar';
import TaskDeviceChip from '../features/TaskDeviceChip';
import TaskPriorityTag from '../features/TaskPriorityTag';
import TaskRepoChip from '../features/TaskRepoChip';
import TaskStatusTag from '../features/TaskStatusTag';
import TaskTriggerTag from '../features/TaskTriggerTag';
import { UnassignedAssigneeIcon } from '../features/UnassignedAssigneeIcon';
import { shouldShowMemberAssignee } from '../shared/memberAssigneeMode';
import { useUserDisplayMeta } from '../shared/useUserDisplayMeta';
import TaskAcceptanceStateRow from './TaskAcceptanceStateRow';
import { taskDetailLayoutStyles as styles } from './taskDetailLayoutStyles';
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
  const assigneeAgentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const taskConfig = useTaskStore((s) => taskDetailSelectors.activeTaskDetail(s)?.config);
  const updateTaskExecution = useTaskStore((s) => s.updateTaskExecution);
  const { allowed: canEditTask } = usePermission('create_content');
  const memberMeta = useUserDisplayMeta(assigneeUserId);
  const activeWorkspaceId = useActiveWorkspaceId();

  // Derived from the raw `config` reference so the reader runs once per config
  // change: it builds a fresh object, which as a store selector would report a
  // change on every unrelated update.
  const execution = useMemo(() => readTaskExecutionConfig(taskConfig), [taskConfig]);

  const handleDeviceChange = useCallback(
    (deviceId?: string) => {
      if (taskId) void updateTaskExecution(taskId, { ...execution, boundDeviceId: deviceId });
    },
    [execution, taskId, updateTaskExecution],
  );

  const handleReposChange = useCallback(
    (repos?: string[]) => {
      if (taskId) void updateTaskExecution(taskId, applyTaskReposSelection(execution, repos));
    },
    [execution, taskId, updateTaskExecution],
  );

  if (!taskId) return null;

  const statusMeta = status ? STATUS_META[status] : STATUS_META.backlog;
  const priorityMeta = PRIORITY_META[priority as TaskPriority] ?? PRIORITY_META[0];

  return (
    <div className={styles.properties}>
      <TaskStatusTag status={status} taskIdentifier={taskId}>
        <Block
          clickable
          horizontal
          align="center"
          className={styles.propertyItem}
          gap={8}
          variant={'borderless'}
        >
          <TaskStatusTag disableDropdown size={16} status={status} taskIdentifier={taskId} />
          <Text weight={500}>{t(`taskDetail.${statusMeta.labelKey}` as never)}</Text>
        </Block>
      </TaskStatusTag>

      {/* The human layer: whether the delivery is accepted. Read-only here —
          the decision itself is made on the acceptance page this links to.
          Recurring tasks have no delivery acceptance, so no state to show. */}
      {!automationMode && <TaskAcceptanceStateRow />}

      <TaskPriorityTag priority={priority} taskIdentifier={taskId}>
        <Block
          clickable
          horizontal
          align="center"
          className={styles.propertyItem}
          gap={8}
          variant={'borderless'}
        >
          <TaskPriorityTag disableDropdown priority={priority} size={16} taskIdentifier={taskId} />
          <Text weight={500}>{t(`taskDetail.${priorityMeta.labelKey}` as never)}</Text>
        </Block>
      </TaskPriorityTag>

      {shouldShowMemberAssignee(activeWorkspaceId, assigneeUserId) && (
        <AssigneeMemberSelector
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
            className={styles.propertyItem}
            gap={8}
            variant={'borderless'}
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

      {/* Where the runs go. Read-only members still see it — knowing the task is
          pinned to another machine is exactly the context they need. */}
      {assigneeAgentId && (
        <TaskDeviceChip
          agentId={assigneeAgentId}
          className={styles.propertyItem}
          disabled={!canEditTask}
          value={execution?.boundDeviceId}
          onChange={handleDeviceChange}
        />
      )}
      {assigneeAgentId && (
        <TaskRepoChip
          agentId={assigneeAgentId}
          className={styles.propertyItem}
          disabled={!canEditTask}
          value={execution?.repos}
          onChange={handleReposChange}
        />
      )}

      <TaskScheduleConfig>
        <Block
          clickable
          horizontal
          align="center"
          className={styles.propertyItem}
          gap={8}
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
    </div>
  );
});

export default TaskProperties;

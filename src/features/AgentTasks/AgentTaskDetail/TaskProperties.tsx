import type { TaskPriority, TaskStatus } from '@lobechat/types';
import { Block, cssVar, Icon, Text } from '@lobehub/ui';
import { ArchiveIcon, Stamp, TagIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import TaskLabelChips from '@/features/TaskLabels/TaskLabelChips';
import TaskLabelPicker from '@/features/TaskLabels/TaskLabelPicker';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import AssigneeMemberSelector from '../features/AssigneeMemberSelector';
import AssigneeUserAvatar from '../features/AssigneeUserAvatar';
import ProjectSelector from '../features/ProjectSelector';
import TaskPriorityTag from '../features/TaskPriorityTag';
import TaskProjectValue from '../features/TaskProjectValue';
import TaskStatusTag from '../features/TaskStatusTag';
import TaskTriggerTag from '../features/TaskTriggerTag';
import { UnassignedAssigneeIcon } from '../features/UnassignedAssigneeIcon';
import { shouldShowMemberAssignee } from '../shared/memberAssigneeMode';
import { useUserDisplayMeta } from '../shared/useUserDisplayMeta';
import TaskAcceptanceStateRow from './TaskAcceptanceStateRow';
import { taskDetailLayoutStyles as styles } from './taskDetailLayoutStyles';
import TaskScheduleConfig from './TaskScheduleConfig';
import { useTaskAcceptanceWait } from './useTaskAcceptanceWait';

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
  const isArchived = !!useTaskStore(taskDetailSelectors.activeTaskArchivedAt);
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
  const acceptanceWait = useTaskAcceptanceWait();
  const taskDatabaseId = useTaskStore(taskDetailSelectors.activeTaskDatabaseId);
  const labels = useTaskStore(taskDetailSelectors.activeTaskLabels);
  const setTaskLabels = useTaskStore((s) => s.setTaskLabels);
  const projectId = useTaskStore(taskDetailSelectors.activeTaskProjectId);
  const hasParent = !!useTaskStore(taskDetailSelectors.activeTaskParent);
  // The picker renders nothing while the Projects lab is off, which would leave
  // the group's title standing over an empty row.
  const enableProjects = useUserStore(labPreferSelectors.enableProjects);

  if (!taskId) return null;

  const statusMeta = status ? STATUS_META[status] : STATUS_META.backlog;
  const priorityMeta = PRIORITY_META[priority as TaskPriority] ?? PRIORITY_META[0];

  return (
    <div className={styles.properties}>
      <section className={styles.propertyGroup}>
        <div className={styles.propertyGroupTitle}>{t('taskDetail.properties')}</div>
        <TaskStatusTag status={status} taskIdentifier={taskId}>
          <Block
            clickable
            horizontal
            align="center"
            className={styles.propertyItem}
            gap={8}
            variant={'borderless'}
          >
            {/* `running` covers both an executing agent and a stopped one whose
                acceptance round has yet to settle; only the first is "in progress". */}
            {acceptanceWait ? (
              <Icon color={cssVar.colorWarning} icon={Stamp} size={16} />
            ) : (
              <TaskStatusTag disableDropdown size={16} status={status} taskIdentifier={taskId} />
            )}
            <Text weight={500}>
              {acceptanceWait
                ? t('taskDetail.status.awaitingAcceptance')
                : t(`taskDetail.${statusMeta.labelKey}` as never)}
            </Text>
          </Block>
        </TaskStatusTag>

        {/* Archived is the user's close-out on top of the status, not a status
            itself — shown read-only; the header menu restores it. */}
        {isArchived && (
          <Block
            horizontal
            align="center"
            className={styles.propertyItem}
            gap={8}
            variant={'borderless'}
          >
            <Icon color={cssVar.colorTextDescription} icon={ArchiveIcon} size={16} />
            <Text style={{ color: cssVar.colorTextDescription }} weight={500}>
              {t('taskList.archived')}
            </Text>
          </Block>
        )}

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
            <TaskPriorityTag
              disableDropdown
              priority={priority}
              size={16}
              taskIdentifier={taskId}
            />
            <Text weight={500}>{t(`taskDetail.${priorityMeta.labelKey}` as never)}</Text>
          </Block>
        </TaskPriorityTag>

        {shouldShowMemberAssignee(activeWorkspaceId, assigneeUserId) && (
          <AssigneeMemberSelector
            currentUserId={assigneeUserId}
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

        {/* Where the runs go lives in the detail header's main column, next to the
            assignee it inherits from — not in this rail. See
            `TaskExecutionConfig`. */}

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
      </section>

      <section className={styles.propertyGroup}>
        <div className={styles.propertyGroupTitle}>{t('taskLabel.label')}</div>
        <TaskLabelPicker
          disabled={!taskDatabaseId}
          value={labels}
          onChange={(next) => {
            if (taskDatabaseId) void setTaskLabels(taskDatabaseId, labels, next);
          }}
        >
          <Block
            clickable
            horizontal
            align="center"
            className={styles.propertyItem}
            gap={8}
            // Property rows have a fixed height; this one grows with wrapped chips
            // so a second line never overlaps the row below.
            style={{ flexWrap: 'wrap', height: 'auto', minHeight: 30, paddingBlock: 4 }}
            variant={'borderless'}
          >
            {labels.length > 0 ? (
              <TaskLabelChips wrap labels={labels} max={6} />
            ) : (
              <>
                <Icon color={cssVar.colorTextDescription} icon={TagIcon} size={16} />
                <Text style={{ color: cssVar.colorTextDescription }} weight={500}>
                  {t('taskLabel.add')}
                </Text>
              </>
            )}
          </Block>
        </TaskLabelPicker>
      </section>

      {enableProjects && (
        <section className={styles.propertyGroup}>
          <div className={styles.propertyGroupTitle}>{t('taskProject.label')}</div>
          {/* A subtask lives in its parent's project: the server refuses to split them. */}
          <ProjectSelector
            fullWidth
            disabledReason={hasParent ? t('taskProject.inheritedFromParent') : undefined}
            taskIdentifier={taskId}
            value={projectId}
          >
            <Block
              clickable
              horizontal
              align="center"
              className={styles.propertyItem}
              gap={8}
              variant={'borderless'}
            >
              <TaskProjectValue
                emptyLabel={t('taskProject.add')}
                iconSize={16}
                projectId={projectId}
                weight={500}
              />
            </Block>
          </ProjectSelector>
        </section>
      )}
    </div>
  );
});

export default TaskProperties;

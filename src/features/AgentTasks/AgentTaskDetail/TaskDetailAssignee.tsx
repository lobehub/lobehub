import type { TaskStatus } from '@lobechat/types';
import { Block, cssVar, Text, Tooltip } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import HeterogeneousTag from '@/features/HeterogeneousTag';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import AssigneeAgentSelector from '../features/AssigneeAgentSelector';
import AssigneeAvatar from '../features/AssigneeAvatar';
import { UnassignedAssigneeIcon } from '../features/UnassignedAssigneeIcon';
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';
import { taskDetailLayoutStyles as styles } from './taskDetailLayoutStyles';

const TaskDetailAssignee = memo(() => {
  const { t } = useTranslation('chat');
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const status = useTaskStore(taskDetailSelectors.activeTaskStatus) as TaskStatus | undefined;
  const assigneeAgentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const visibility = useTaskStore(taskDetailSelectors.activeTaskVisibility);
  const createdByUserId = useTaskStore(taskDetailSelectors.activeTaskCreatedByUserId);
  const assigneeMeta = useAgentDisplayMeta(assigneeAgentId);
  // Same source as the home list so the runtime tag stays consistent.
  const assigneeHeterogeneousType = useHomeStore(
    (s) => homeAgentListSelectors.getAgentById(assigneeAgentId ?? '')(s)?.heterogeneousType,
  );

  if (!taskId) return null;

  return (
    <AssigneeAgentSelector
      currentAgentId={assigneeAgentId}
      disabled={status === 'running'}
      taskCreatorId={createdByUserId}
      taskIdentifier={taskId}
      taskVisibility={visibility}
    >
      <Tooltip title={assigneeAgentId ? undefined : t('taskList.unassignedAgentHint')}>
        <Block
          clickable
          horizontal
          align="center"
          className={styles.propertyItem}
          gap={8}
          variant={'borderless'}
        >
          {assigneeAgentId ? (
            <>
              <AssigneeAvatar agentId={assigneeAgentId} size={16} />
              <Text ellipsis style={{ minWidth: 0 }} weight={500}>
                {assigneeMeta?.title}
              </Text>
              <HeterogeneousTag type={assigneeHeterogeneousType} />
            </>
          ) : (
            <>
              <UnassignedAssigneeIcon kind={'agent'} size={16} />
              <Text style={{ color: cssVar.colorTextDescription }} weight={500}>
                {t('createTask.assignee')}
              </Text>
            </>
          )}
        </Block>
      </Tooltip>
    </AssigneeAgentSelector>
  );
});

export default TaskDetailAssignee;

import type { TaskStatus } from '@lobechat/types';
import { Flexbox, Tooltip } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';

import { shouldShowMemberAssignee } from '../shared/memberAssigneeMode';
import AssigneeAgentSelector from './AssigneeAgentSelector';
import AssigneeAvatar from './AssigneeAvatar';
import AssigneeMemberSelector from './AssigneeMemberSelector';
import AssigneeUserAvatar from './AssigneeUserAvatar';
import { UnassignedAssigneeIcon } from './UnassignedAssigneeIcon';

interface TaskAssigneeCellProps {
  status: TaskStatus;
  task: {
    assigneeAgentId?: string | null;
    assigneeUserId?: string | null;
    createdByUserId?: string | null;
    id: string;
    visibility?: 'private' | 'public';
  };
}

/**
 * Who a task row belongs to: its member owner (workspace only) and the agent
 * that executes it, each a picker for reassigning in place.
 */
export const TaskAssigneeCell = ({ status, task }: TaskAssigneeCellProps) => {
  const { t } = useTranslation('chat');
  const activeWorkspaceId = useActiveWorkspaceId();

  return (
    <Flexbox horizontal align={'center'} flex={'none'} gap={4}>
      {shouldShowMemberAssignee(activeWorkspaceId, task.assigneeUserId) && (
        <AssigneeMemberSelector
          currentUserId={task.assigneeUserId}
          taskCreatorId={task.createdByUserId}
          taskIdentifier={task.id}
          taskVisibility={task.visibility}
        >
          {task.assigneeUserId ? (
            <AssigneeUserAvatar profileCard userId={task.assigneeUserId} />
          ) : (
            <Tooltip title={t('taskList.assignTo')}>
              <UnassignedAssigneeIcon kind={'human'} />
            </Tooltip>
          )}
        </AssigneeMemberSelector>
      )}
      <AssigneeAgentSelector
        currentAgentId={task.assigneeAgentId}
        disabled={status === 'running'}
        taskCreatorId={task.createdByUserId}
        taskIdentifier={task.id}
        taskVisibility={task.visibility}
      >
        {task.assigneeAgentId ? (
          <AssigneeAvatar agentId={task.assigneeAgentId} profileCard={status !== 'running'} />
        ) : (
          <Tooltip title={status === 'running' ? undefined : t('taskList.assignTo')}>
            <AssigneeAvatar agentId={task.assigneeAgentId} />
          </Tooltip>
        )}
      </AssigneeAgentSelector>
    </Flexbox>
  );
};

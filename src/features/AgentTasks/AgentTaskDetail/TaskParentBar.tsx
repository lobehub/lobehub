import { Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { taskKeys } from '@/libs/swr/keys';
import { taskDetailProjectionSelectors } from '@/projection/modules/task/derivedSelectors';
import { useTaskDetailProjectionRequest } from '@/projection/modules/task/hooks';
import { useActiveTaskDetailProjection } from '@/store/task';

import TaskStatusIcon from '../features/TaskStatusIcon';
import TaskSubtaskProgressTag from '../features/TaskSubtaskProgressTag';
import { taskDetailPath } from '../shared/taskDetailPath';

const TASK_STATUS_SET = new Set([
  'backlog',
  'canceled',
  'completed',
  'failed',
  'paused',
  'running',
] as const);

type TaskStatus = 'backlog' | 'canceled' | 'completed' | 'failed' | 'paused' | 'running';

const toTaskStatus = (status?: string): TaskStatus =>
  status && TASK_STATUS_SET.has(status as TaskStatus) ? (status as TaskStatus) : 'backlog';

const TaskParentBar = memo(() => {
  const { t } = useTranslation('chat');
  const navigate = useWorkspaceAwareNavigate();
  const parent = useActiveTaskDetailProjection(taskDetailProjectionSelectors.activeTaskParent);
  const currentIdentifier = useActiveTaskDetailProjection(
    taskDetailProjectionSelectors.activeTaskDetail,
  )?.identifier;
  const { data: parentDetail } = useTaskDetailProjectionRequest(
    taskKeys.detail(parent?.identifier ?? ''),
    parent?.identifier,
    { missing: 'null', revalidateOnFocus: false },
  );
  const parentSubtasks = parentDetail?.subtasks ?? [];
  const parentStatus = toTaskStatus(parentDetail?.status);

  if (!parent) return null;

  const parentAgentId = parent.agentId === undefined ? parentDetail?.agentId : parent.agentId;

  return (
    <Flexbox horizontal align="center" gap={8}>
      <Text fontSize={12} type={'secondary'}>
        {t('taskDetail.subIssueOf')}
      </Text>
      <Button
        icon={<TaskStatusIcon size={16} status={parentStatus} />}
        size={'small'}
        type={'text'}
        onClick={() => navigate(taskDetailPath(parent.identifier, parentAgentId ?? undefined))}
      >
        <Text weight={500}>{parent.name}</Text>
      </Button>
      {parentSubtasks.length > 0 && (
        <TaskSubtaskProgressTag
          currentIdentifier={currentIdentifier}
          subtasks={parentSubtasks}
          onSubtaskClick={(identifier, assigneeAgentId) =>
            navigate(taskDetailPath(identifier, assigneeAgentId))
          }
        />
      )}
    </Flexbox>
  );
});

export default TaskParentBar;

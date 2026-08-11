import type { TaskDetailData } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import {
  getProjectionStoreState,
  nextProjectionObservedAt,
  useTaskDetailProjection,
} from '@/projection';
import { taskService } from '@/services/task';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

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
  const parent = useTaskStore(taskDetailSelectors.activeTaskParent);
  const currentIdentifier = useTaskStore(taskDetailSelectors.activeTaskDetail)?.identifier;
  const parentDetail = useTaskDetailProjection(parent?.identifier);
  const parentSubtasks = parentDetail?.subtasks ?? [];
  const parentStatus = toTaskStatus(parentDetail?.status);

  useEffect(() => {
    if (!parent?.identifier) return;

    const scope = getCacheScope();
    const observedAt = nextProjectionObservedAt();
    taskService
      .getDetail(parent.identifier)
      .then((res) => {
        const detail = res.data as TaskDetailData | null;
        if (detail) {
          getProjectionStoreState().commitTaskDetail(scope, detail, 'network', observedAt);
        } else {
          getProjectionStoreState().deleteTaskProjection(scope, parent.identifier, observedAt);
        }
      })
      .catch((err) => {
        console.error('[TaskParentBar] Failed to load parent subtasks', err);
      });
  }, [parent?.identifier]);

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

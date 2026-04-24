import type { TaskDetailData, TaskDetailSubtask } from '@lobechat/types';
import { Button, Flexbox, Text } from '@lobehub/ui';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { taskService } from '@/services/task';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import TaskStatusIcon from '../features/TaskStatusIcon';
import TaskSubtaskProgressTag from '../features/TaskSubtaskProgressTag';

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
  const navigate = useNavigate();
  const parent = useTaskStore(taskDetailSelectors.activeTaskParent);
  const currentIdentifier = useTaskStore(taskDetailSelectors.activeTaskDetail)?.identifier;

  const [parentSubtasks, setParentSubtasks] = useState<TaskDetailSubtask[]>([]);
  const [parentStatus, setParentStatus] = useState<TaskStatus>('backlog');

  useEffect(() => {
    setParentSubtasks([]);
    setParentStatus('backlog');
    if (!parent?.identifier) return;

    taskService
      .getDetail(parent.identifier)
      .then((res) => {
        const detail = res.data as TaskDetailData;
        setParentStatus(toTaskStatus(detail.status));
        setParentSubtasks(detail.subtasks ?? []);
      })
      .catch((err) => {
        console.error('[TaskParentBar] Failed to load parent subtasks', err);
      });
  }, [parent?.identifier]);

  if (!parent) return null;

  return (
    <Flexbox horizontal align="center" gap={8}>
      <Text fontSize={12} type={'secondary'}>
        {t('taskDetail.subIssueOf')}
      </Text>
      <Button
        icon={<TaskStatusIcon size={16} status={parentStatus} />}
        size={'small'}
        type={'text'}
        onClick={() => navigate(`/task/${parent.identifier}`)}
      >
        <Text weight={500}>{parent.name}</Text>
      </Button>
      {parentSubtasks.length > 0 && (
        <TaskSubtaskProgressTag
          currentIdentifier={currentIdentifier}
          subtasks={parentSubtasks}
          onSubtaskClick={(identifier) => navigate(`/task/${identifier}`)}
        />
      )}
    </Flexbox>
  );
});

export default TaskParentBar;

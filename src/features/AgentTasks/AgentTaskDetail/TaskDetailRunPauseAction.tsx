import { Button } from 'antd';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

const TaskDetailRunPauseAction = memo(() => {
  const { t } = useTranslation('chat');
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const canRun = useTaskStore(taskDetailSelectors.canRunActiveTask);
  const canPause = useTaskStore(taskDetailSelectors.canPauseActiveTask);
  const runTask = useTaskStore((s) => s.runTask);
  const pauseTask = useTaskStore((s) => s.pauseTask);

  const handleRunOrPause = useCallback(() => {
    if (!taskId) return;
    if (canRun) runTask(taskId);
    else if (canPause) pauseTask(taskId);
  }, [taskId, canRun, canPause, runTask, pauseTask]);

  if (!canRun && !canPause) return null;

  return (
    <Button size="small" type={canRun ? 'primary' : 'default'} onClick={handleRunOrPause}>
      {canRun ? t('taskDetail.runTask') : t('taskDetail.pauseTask')}
    </Button>
  );
});

export default TaskDetailRunPauseAction;

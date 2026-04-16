import { Button } from '@lobehub/ui';
import { CircleStop, PlayIcon } from 'lucide-react';
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
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);

  const handleRunOrPause = useCallback(() => {
    if (!taskId) return;
    if (canRun) runTask(taskId);
    else if (canPause) updateTaskStatus(taskId, 'paused');
  }, [taskId, canRun, canPause, runTask, updateTaskStatus]);

  if (!canRun && !canPause) return null;

  return (
    <Button icon={canRun ? PlayIcon : CircleStop} type={'primary'} onClick={handleRunOrPause}>
      {canRun ? t('taskDetail.runTask') : t('taskDetail.pauseTask')}
    </Button>
  );
});

export default TaskDetailRunPauseAction;

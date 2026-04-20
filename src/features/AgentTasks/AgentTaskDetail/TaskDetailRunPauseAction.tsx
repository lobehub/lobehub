import { Button } from '@lobehub/ui';
import { PlayIcon, RotateCcwIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import StopLoadingIcon from '@/components/StopLoading';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

const TaskDetailRunPauseAction = memo(() => {
  const { t } = useTranslation('chat');
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const canRun = useTaskStore(taskDetailSelectors.canRunActiveTask);
  const canPause = useTaskStore(taskDetailSelectors.canPauseActiveTask);
  const status = useTaskStore(taskDetailSelectors.activeTaskStatus);
  const isRerun = status === 'completed';
  const runTask = useTaskStore((s) => s.runTask);
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);

  const handleRunOrPause = useCallback(() => {
    if (!taskId) return;
    if (canRun) runTask(taskId);
    else if (canPause) updateTaskStatus(taskId, 'paused');
  }, [taskId, canRun, canPause, runTask, updateTaskStatus]);

  if (!canRun && !canPause) return null;

  if (canPause) {
    return (
      <Button icon={StopLoadingIcon} onClick={handleRunOrPause}>
        {t('taskDetail.stopTask')}
      </Button>
    );
  }

  const runLabel = isRerun ? t('taskDetail.rerunTask') : t('taskDetail.runTask');
  const runIcon = isRerun ? RotateCcwIcon : PlayIcon;

  return (
    <Button icon={runIcon} type={'primary'} onClick={handleRunOrPause}>
      {runLabel}
    </Button>
  );
});

export default TaskDetailRunPauseAction;

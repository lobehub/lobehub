import { Button } from '@lobehub/ui';
import { PlayIcon, RotateCcwIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import StopLoadingIcon from '@/components/StopLoading';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

const TaskDetailRunPauseAction = memo(() => {
  const { t } = useTranslation('chat');
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const canRun = useTaskStore(taskDetailSelectors.canRunActiveTask);
  const canPause = useTaskStore(taskDetailSelectors.canPauseActiveTask);
  const status = useTaskStore(taskDetailSelectors.activeTaskStatus);
  const assigneeAgentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const isRerun = status === 'completed';
  const runTask = useTaskStore((s) => s.runTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);

  const [isStarting, setIsStarting] = useState(false);

  const handleRunOrPause = useCallback(async () => {
    if (!taskId) return;
    if (canPause) {
      await updateTaskStatus(taskId, 'paused');
      return;
    }
    if (!canRun) return;
    setIsStarting(true);
    try {
      if (!assigneeAgentId && inboxAgentId) {
        await updateTask(taskId, { assigneeAgentId: inboxAgentId });
      }
      await runTask(taskId);
    } finally {
      setIsStarting(false);
    }
  }, [
    taskId,
    canRun,
    canPause,
    assigneeAgentId,
    inboxAgentId,
    runTask,
    updateTask,
    updateTaskStatus,
  ]);

  if (!canRun && !canPause && !isStarting) return null;

  if (isStarting) {
    const pendingLabel = isRerun ? t('taskDetail.rerunTask') : t('taskDetail.runTask');
    return (
      <Button disabled loading type={'primary'}>
        {pendingLabel}
      </Button>
    );
  }

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

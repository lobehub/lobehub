import { Button, Flexbox, Text } from '@lobehub/ui';
import { CalendarOffIcon, PlayIcon, RotateCcwIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import StopLoadingIcon from '@/components/StopLoading';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import { nextHeartbeatFiring, nextScheduleFiring } from './scheduler/helpers';

const padTime = (n: number) => String(n).padStart(2, '0');

const formatCountdown = (msRemaining: number): string => {
  const totalSeconds = Math.max(0, Math.floor(msRemaining / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${padTime(hours)}:${padTime(minutes)}:${padTime(seconds)}`;
  return `${padTime(minutes)}:${padTime(seconds)}`;
};

const TaskDetailRunPauseAction = memo(() => {
  const { t } = useTranslation('chat');
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const canRun = useTaskStore(taskDetailSelectors.canRunActiveTask);
  const canPause = useTaskStore(taskDetailSelectors.canPauseActiveTask);
  const status = useTaskStore(taskDetailSelectors.activeTaskStatus);
  const detail = useTaskStore(taskDetailSelectors.activeTaskDetail);
  const automationMode = useTaskStore(taskDetailSelectors.activeTaskAutomationMode);
  const interval = useTaskStore(taskDetailSelectors.activeTaskPeriodicInterval);
  const schedulePattern = useTaskStore(taskDetailSelectors.activeTaskSchedulePattern);
  const scheduleTimezone = useTaskStore(taskDetailSelectors.activeTaskScheduleTimezone);
  const assigneeAgentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const isRerun = status === 'completed';
  const runTask = useTaskStore((s) => s.runTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const updateTaskStatus = useTaskStore((s) => s.updateTaskStatus);
  const setAutomationMode = useTaskStore((s) => s.setAutomationMode);

  const [isStarting, setIsStarting] = useState(false);
  const [isCancellingSchedule, setIsCancellingSchedule] = useState(false);

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

  const handleCancelSchedule = useCallback(async () => {
    if (!taskId) return;
    setIsCancellingSchedule(true);
    try {
      await setAutomationMode(taskId, null);
      if (status === 'scheduled') {
        await updateTaskStatus(taskId, 'backlog');
      }
    } finally {
      setIsCancellingSchedule(false);
    }
  }, [taskId, setAutomationMode, updateTaskStatus, status]);

  const isScheduled = status === 'scheduled';

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isScheduled) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isScheduled]);

  const countdownText = useMemo(() => {
    if (!isScheduled) return null;
    let next = null;
    if (automationMode === 'heartbeat') {
      next = nextHeartbeatFiring(detail?.heartbeat?.lastAt, interval);
    } else if (automationMode === 'schedule' && schedulePattern) {
      next = nextScheduleFiring(schedulePattern, scheduleTimezone);
    }
    if (!next) return null;
    return formatCountdown(next.toDate().getTime() - nowMs);
  }, [
    isScheduled,
    automationMode,
    detail?.heartbeat?.lastAt,
    interval,
    schedulePattern,
    scheduleTimezone,
    nowMs,
  ]);

  if (isScheduled) {
    return (
      <Flexbox horizontal align={'center'} gap={12}>
        <Button
          icon={CalendarOffIcon}
          loading={isCancellingSchedule}
          onClick={handleCancelSchedule}
        >
          {t('taskDetail.cancelSchedule')}
        </Button>
        {countdownText && (
          <Text fontSize={12} type={'secondary'}>
            {t('taskDetail.nextRunCountdown', { countdown: countdownText })}
          </Text>
        )}
      </Flexbox>
    );
  }

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

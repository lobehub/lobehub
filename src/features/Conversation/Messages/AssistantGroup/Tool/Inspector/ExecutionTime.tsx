import { Text } from '@lobehub/ui';
import { memo, useEffect, useState } from 'react';

interface ExecutionTimeProps {
  isExecuting: boolean;
  startTime?: number;
  timerKey: string;
}

const UPDATE_INTERVAL_MS = 100;
const START_TIME_CACHE_TTL_MS = 60_000;
const executionStartTimeCache = new Map<string, number>();
const executionStartTimeCleanupTimers = new Map<string, number>();

const clearExecutionStartTimeCleanup = (timerKey: string) => {
  const cleanupTimer = executionStartTimeCleanupTimers.get(timerKey);
  if (cleanupTimer === undefined) return;

  window.clearTimeout(cleanupTimer);
  executionStartTimeCleanupTimers.delete(timerKey);
};

const scheduleExecutionStartTimeCleanup = (timerKey: string) => {
  clearExecutionStartTimeCleanup(timerKey);

  const cleanupTimer = window.setTimeout(() => {
    executionStartTimeCache.delete(timerKey);
    executionStartTimeCleanupTimers.delete(timerKey);
  }, START_TIME_CACHE_TTL_MS);

  executionStartTimeCleanupTimers.set(timerKey, cleanupTimer);
};

const formatElapsedTime = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;

  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}min${remainingSeconds}s`;
};

const ExecutionTime = memo<ExecutionTimeProps>(({ isExecuting, startTime, timerKey }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isExecuting) {
      clearExecutionStartTimeCleanup(timerKey);
      executionStartTimeCache.delete(timerKey);
      setElapsed(0);
      return;
    }

    clearExecutionStartTimeCleanup(timerKey);

    const resolvedStartTime = startTime ?? executionStartTimeCache.get(timerKey) ?? Date.now();
    executionStartTimeCache.set(timerKey, resolvedStartTime);

    const update = () => {
      setElapsed(Math.max(0, Date.now() - resolvedStartTime));
    };

    update();
    const interval = window.setInterval(update, UPDATE_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
      scheduleExecutionStartTimeCleanup(timerKey);
    };
  }, [isExecuting, startTime, timerKey]);

  if (!isExecuting) return null;

  return (
    <Text fontSize={12} style={{ flexShrink: 0, whiteSpace: 'nowrap' }} type="secondary">
      {formatElapsedTime(elapsed)}
    </Text>
  );
});

export default ExecutionTime;

import { Text } from '@lobehub/ui';
import { memo, useEffect, useState } from 'react';

interface ExecutionTimeProps {
  isExecuting: boolean;
  startTime?: number;
  timerKey: string;
}

const UPDATE_INTERVAL_MS = 100;
const executionStartTimeCache = new Map<string, number>();

const formatElapsedTime = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;

  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;

  const minutes = seconds / 60;
  return `${minutes.toFixed(1)}min`;
};

const ExecutionTime = memo<ExecutionTimeProps>(({ isExecuting, startTime, timerKey }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isExecuting) {
      executionStartTimeCache.delete(timerKey);
      setElapsed(0);
      return;
    }

    const resolvedStartTime = startTime ?? executionStartTimeCache.get(timerKey) ?? Date.now();
    executionStartTimeCache.set(timerKey, resolvedStartTime);

    const update = () => {
      setElapsed(Math.max(0, Date.now() - resolvedStartTime));
    };

    update();
    const interval = window.setInterval(update, UPDATE_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
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

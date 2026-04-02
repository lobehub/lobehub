import { Text } from '@lobehub/ui';
import { memo, useEffect, useRef, useState } from 'react';

interface ExecutionTimeProps {
  isExecuting: boolean;
}

const formatElapsedTime = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;

  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;

  const minutes = seconds / 60;
  return `${minutes.toFixed(1)}min`;
};

const ExecutionTime = memo<ExecutionTimeProps>(({ isExecuting }) => {
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef(Date.now());
  const rafRef = useRef<number | null>(null);
  const lastUpdateRef = useRef(0);

  useEffect(() => {
    if (!isExecuting) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    startTimeRef.current = Date.now();
    setElapsed(0);

    const update = (timestamp: number) => {
      if (timestamp - lastUpdateRef.current >= 100) {
        setElapsed(Date.now() - startTimeRef.current);
        lastUpdateRef.current = timestamp;
      }
      rafRef.current = requestAnimationFrame(update);
    };

    rafRef.current = requestAnimationFrame(update);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isExecuting]);

  if (!isExecuting) return null;

  return (
    <Text fontSize={12} style={{ flexShrink: 0, whiteSpace: 'nowrap' }} type="secondary">
      {formatElapsedTime(elapsed)}
    </Text>
  );
});

export default ExecutionTime;

import { formatElapsedClockTime } from '@lobechat/utils';
import { Text } from '@lobehub/ui';
import { memo, useEffect, useState } from 'react';

interface RunningElapsedTimeProps {
  startTime?: Date | number | string | null;
}

export const resolveTopicTriggerTime = (
  startTime: Date | number | string | null | undefined,
  fallbackTime: Date | number | string,
) => startTime ?? fallbackTime;

export const RunningElapsedTime = memo<RunningElapsedTimeProps>(({ startTime }) => {
  const startTimeMs = startTime == null ? undefined : new Date(startTime).getTime();
  const hasValidStartTime = startTimeMs !== undefined && Number.isFinite(startTimeMs);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!hasValidStartTime) return;

    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [hasValidStartTime, startTimeMs]);

  if (!hasValidStartTime) return null;

  return (
    <Text
      fontSize={12}
      style={{ flex: 'none', fontVariantNumeric: 'tabular-nums' }}
      type={'secondary'}
    >
      {formatElapsedClockTime(now - startTimeMs)}
    </Text>
  );
});

RunningElapsedTime.displayName = 'RunningElapsedTime';

'use client';

import { formatElapsedClockTime } from '@lobechat/utils';
import { Text } from '@lobehub/ui';
import { memo, useEffect, useState } from 'react';

interface GoalElapsedTimeProps {
  startedAt?: Date | number | string | null;
}

const GoalElapsedTime = memo<GoalElapsedTimeProps>(({ startedAt }) => {
  const startedAtMs = startedAt == null ? undefined : new Date(startedAt).getTime();
  const hasValidStartTime = startedAtMs !== undefined && Number.isFinite(startedAtMs);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!hasValidStartTime) return;

    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [hasValidStartTime, startedAtMs]);

  if (!hasValidStartTime) return null;

  return (
    <Text
      fontSize={12}
      style={{ flex: 'none', fontVariantNumeric: 'tabular-nums' }}
      type={'secondary'}
    >
      {formatElapsedClockTime(now - startedAtMs)}
    </Text>
  );
});

GoalElapsedTime.displayName = 'GoalElapsedTime';

export default GoalElapsedTime;

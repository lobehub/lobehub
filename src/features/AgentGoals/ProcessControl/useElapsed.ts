import { formatDuration } from '@lobechat/utils';
import { useEffect, useState } from 'react';

/** Same digit-unit shape the Task page's run cards use: `12s` · `3m 12s` · `1h 04m` · `1d 05h 04m`. */
export const formatElapsed = (ms: number): string => formatDuration(ms, { pad: true });

/** Live "how long has this been running" label; idle when there is nothing running. */
export const useElapsed = (startedAt?: Date): string => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return startedAt ? formatElapsed(now - startedAt.getTime()) : '';
};

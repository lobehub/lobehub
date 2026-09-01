import { useEffect, useState } from 'react';

/** Same digit-unit shape the Task page's run cards use: `12s` · `3m 12s` · `1h 04m`. */
export const formatElapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
};

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

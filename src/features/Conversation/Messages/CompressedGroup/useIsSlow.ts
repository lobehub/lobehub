import { useEffect, useState } from 'react';

/** How long compressing runs before the row adds that it may take a while. */
export const SLOW_AFTER_MS = 10_000;

/** Whether `running` has stayed true for `SLOW_AFTER_MS`; resets when it stops. */
export const useIsSlow = (running: boolean) => {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    setSlow(false);
    if (!running) return;

    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [running]);

  return running && slow;
};

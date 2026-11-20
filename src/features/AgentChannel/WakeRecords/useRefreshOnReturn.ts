import { useEffect, useRef } from 'react';

/**
 * Calls `refresh` each time `active` turns true again after the first time. The records panel
 * stays mounted while hidden, so without this, messages the bot judged meanwhile (the owner was on
 * another tab testing it) would not appear when they come back.
 */
export const useRefreshOnReturn = (active: boolean, refresh: () => void) => {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const wasActive = useRef(active);

  useEffect(() => {
    if (active && !wasActive.current) refreshRef.current();
    wasActive.current = active;
  }, [active]);
};

import { useLayoutEffect, useRef, useState } from 'react';

import { useActiveLocation } from './useActiveLocation';

/**
 * Closes a floating host (popover, panel) once the active location changes, so
 * any link or `navigate()` call inside its content leaves the host behind
 * without wiring a close callback through every entry.
 *
 * The identity combines `key` with the path: web navigations always mint a new
 * `key` (also for same-path pushes), while the desktop tab mirror keeps a fixed
 * key and only changes its URL.
 *
 * Only for hosts whose every navigation should dismiss them; a click that does
 * not commit a navigation (for example re-selecting the current item) still
 * needs an explicit close.
 *
 * Returns a key for the host's popover element. A navigation can hide the host
 * instead of re-rendering it (the home sidebar stays in a hidden `<Activity>`
 * on other routes); a hidden tree runs no effects, so a closing popover never
 * finishes its exit and its portaled popup stays on screen. On hide the key
 * changes, remounting the popover so React drops the popup directly.
 */
export const useCloseOnNavigate = (open: boolean, close: () => void): number => {
  const { key, pathname, search } = useActiveLocation();
  const identity = `${key}|${pathname}${search}`;
  const lastIdentity = useRef(identity);
  const latestOpen = useRef(open);
  const [hostKey, setHostKey] = useState(0);

  useLayoutEffect(() => {
    latestOpen.current = open;
  });

  // Layout effect so the destination's first paint is not covered by the host.
  useLayoutEffect(() => {
    if (lastIdentity.current === identity) return;
    lastIdentity.current = identity;
    if (open) close();
    // Keyed on the location only: a new `close` identity must not trigger it.
  }, [identity]);

  // Layout cleanups run when the host is hidden (and on unmount).
  useLayoutEffect(
    () => () => {
      if (!latestOpen.current) return;
      close();
      setHostKey((key) => key + 1);
    },
    [],
  );

  return hostKey;
};

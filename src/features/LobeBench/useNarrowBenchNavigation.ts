import { useResponsive } from '@lobehub/ui';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

import { useGlobalStore } from '@/store/global';

/** Keep desktop LobeBench usable in narrow windows, using the existing panel toggle. */
export const useNarrowBenchNavigation = () => {
  const { md = true } = useResponsive();
  const isNarrow = !md;
  const { key } = useLocation();
  const isStatusInit = useGlobalStore((state) => state.isStatusInit);
  const previous = useRef<{ key: string; narrow: boolean } | undefined>(undefined);
  useEffect(() => {
    if (!isStatusInit) return;
    const enteredNarrow = isNarrow && !previous.current?.narrow;
    const navigated = previous.current !== undefined && previous.current.key !== key;
    if (isNarrow && (enteredNarrow || navigated)) {
      const { status, toggleLeftPanel } = useGlobalStore.getState();
      // This intentionally uses the persisted preference, as the shared header
      // toggle does. Resizing back to wide does not automatically reopen it.
      if (status.showLeftPanel) toggleLeftPanel(false);
    }
    previous.current = { key, narrow: isNarrow };
  }, [isNarrow, isStatusInit, key]);
};

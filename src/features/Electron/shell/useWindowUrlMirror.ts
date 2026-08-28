'use client';

import { useEffect } from 'react';

import { useElectronStore } from '@/store/electron';

import { selectActiveTabUrl } from './activeTabUrl';

// One-way mirror: reflect the active tab's url into the window address so a real
// reload can re-seed tabs (see `useSeedTabsOnBoot`). The slimmed root router
// ignores `replaceState` (no popstate listener), so this never navigates.
export const useWindowUrlMirror = (): void => {
  const url = useElectronStore(selectActiveTabUrl);

  useEffect(() => {
    if (!url) return;
    window.history.replaceState(null, '', url);
  }, [url]);
};

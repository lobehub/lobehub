import { type NavigateOptions, type To } from 'react-router';

import { getTabRouter } from '@/features/Electron/TabHost';
import { useElectronStore } from '@/store/electron';

const getActiveRouter = () => {
  const { activeTabId } = useElectronStore.getState();
  return activeTabId ? getTabRouter(activeTabId) : undefined;
};

export const navigateActiveTab = (to: To, options?: NavigateOptions): void => {
  const router = getActiveRouter();
  if (!router) {
    // The active tab is never evicted, so it always has a live router; a miss
    // means navigation fired before the active tab mounted — drop it rather
    // than rewrite the store (which would violate the one-way mirror).
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[appNavigate] active tab has no live router; navigation ignored:', to);
    }
    return;
  }
  void router.navigate(to, options);
};

export const navigateActiveTabByDelta = (delta: number): void => {
  void getActiveRouter()?.navigate(delta);
};

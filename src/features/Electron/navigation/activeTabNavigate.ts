import { type NavigateOptions, type To } from 'react-router';

// Import the manager directly, not the `@/features/Electron/TabHost` barrel: the
// barrel re-exports `TabHost`, whose static `createTabRouter` import would drag
// `desktopRouter.config` into the boot navigation chain and TDZ-crash init.
import { getTabRouter } from '@/features/Electron/TabHost/tabRouterManager';
import { useElectronStore } from '@/store/electron';

export const navigateTab = (tabId: string | null, to: To, options?: NavigateOptions): void => {
  const router = tabId ? getTabRouter(tabId) : undefined;
  if (!router) {
    // The active tab always has a live router (never evicted); an originating
    // tab's router may be gone (LRU-disposed, or navigation fired before it
    // mounted) — drop the navigation rather than rewrite the store, which
    // would violate the one-way mirror.
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[appNavigate] tab has no live router; navigation ignored:', tabId, to);
    }
    return;
  }
  void router.navigate(to, options);
};

export const navigateTabByDelta = (tabId: string | null, delta: number): void => {
  if (!tabId) return;
  void getTabRouter(tabId)?.navigate(delta);
};

const getActiveTabId = (): string | null => useElectronStore.getState().activeTabId;

export const navigateActiveTab = (to: To, options?: NavigateOptions): void =>
  navigateTab(getActiveTabId(), to, options);

export const navigateActiveTabByDelta = (delta: number): void =>
  navigateTabByDelta(getActiveTabId(), delta);

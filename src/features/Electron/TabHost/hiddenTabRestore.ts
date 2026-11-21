import { navigateTab } from '@/features/Electron/navigation/activeTabNavigate';
import { normalizeTabUrl } from '@/features/Electron/titlebar/TabBar/url';
import { useElectronStore } from '@/store/electron';

import { getTabRouter } from './tabRouterManager';

interface TabRestore {
  from: string;
  to: string;
}

const pendingRestores = new Map<string, TabRestore>();

// Undoing a navigation on a tab that is still on screen would flash the old page
// before the replacement tab paints, so the restore waits until TabHost hides it.
export const restoreTabWhenHidden = (tabId: string, restore: TabRestore): void => {
  pendingRestores.set(tabId, restore);
};

export const flushHiddenTabRestores = (displayedTabIds: readonly string[]): void => {
  for (const [tabId, { from, to }] of pendingRestores) {
    if (displayedTabIds.includes(tabId)) continue;
    pendingRestores.delete(tabId);

    const state = getTabRouter(tabId)?.state;
    if (!state) continue;

    const { hash, pathname, search } = state.navigation.location ?? state.location;
    if (normalizeTabUrl(`${pathname}${search}${hash}`) !== normalizeTabUrl(from)) continue;

    navigateTab(tabId, to, { replace: true });
    useElectronStore.getState().snapshotTabLocation(tabId, to);
  }
};

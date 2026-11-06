import { getActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { getTabRouter } from '@/features/Electron/TabHost/tabRouterManager';
import { isSameTabTarget } from '@/features/Electron/titlebar/TabBar/scope';
import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useElectronStore } from '@/store/electron';

import { navigateActiveTab } from './activeTabNavigate';
import type { AppNavigateOptions } from './appNavigate';

// A hidden tab's reporter is suspended, so its stored url can lag behind its live
// router — match against where the tab actually is.
const currentTabUrl = (tab: TabItem): string => {
  const location = getTabRouter(tab.id)?.state.location;
  return location ? `${location.pathname}${location.search}${location.hash}` : tab.url;
};

export const appNavigate = (to: string, opts: AppNavigateOptions = {}): void => {
  const { target = 'activeTab', escape, ...navOptions } = opts;
  const resolved = buildWorkspaceAwarePath(to, getActiveWorkspaceSlug(), { escape });

  if (target === 'newTab') {
    useElectronStore.getState().addNewTab(resolved);
    return;
  }

  if (target === 'existingTab') {
    const { activateTab, tabs } = useElectronStore.getState();
    const existing = tabs.find((tab) => isSameTabTarget({ url: currentTabUrl(tab) }, resolved));
    if (existing) {
      activateTab(existing.id);
      return;
    }
  }

  navigateActiveTab(resolved, navOptions);
};

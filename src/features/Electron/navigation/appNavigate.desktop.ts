import { getActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { isSameTabTarget } from '@/features/Electron/titlebar/TabBar/scope';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useElectronStore } from '@/store/electron';

import { navigateActiveTab } from './activeTabNavigate';
import type { AppNavigateOptions } from './appNavigate';

export const appNavigate = (to: string, opts: AppNavigateOptions = {}): void => {
  const { target = 'activeTab', escape, ...navOptions } = opts;
  const resolved = buildWorkspaceAwarePath(to, getActiveWorkspaceSlug(), { escape });

  if (target === 'newTab') {
    useElectronStore.getState().addNewTab(resolved);
    return;
  }

  if (target === 'existingTab') {
    const { activateTab, tabs } = useElectronStore.getState();
    const existing = tabs.find((tab) => isSameTabTarget(tab, resolved));
    if (existing) {
      activateTab(existing.id);
      return;
    }
  }

  navigateActiveTab(resolved, navOptions);
};

import { getActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
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

  navigateActiveTab(resolved, navOptions);
};

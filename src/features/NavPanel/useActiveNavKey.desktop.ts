import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useDisplayedTabUrl } from '@/features/Electron/TabHost/displayedTab';

import { resolveNavPanelKey } from './routeKey';

// The route-owned panel registers from inside the tab's layout, so keying the
// panel by the clicked tab before its pane is on screen finds no entry and
// paints the skeleton.
export const useActiveNavKey = () => {
  const url = useDisplayedTabUrl() ?? '/';
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const pathname = url.split(/[#?]/)[0] || '/';

  return resolveNavPanelKey(pathname, activeWorkspaceSlug);
};

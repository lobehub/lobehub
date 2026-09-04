import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { routerSelectors, useRouterStore } from '@/store/router';

import { resolveNavPanelKey } from './routeKey';

export const useActiveNavKey = () => {
  const pathname = useRouterStore(routerSelectors.pathname);
  const activeWorkspaceSlug = useActiveWorkspaceSlug();

  return resolveNavPanelKey(pathname, activeWorkspaceSlug);
};

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useActiveLocation } from '@/hooks/useActiveLocation';

import { resolveRailNavPanelKey } from './railRouteKey';

export const useActiveNavKey = () => {
  const { pathname } = useActiveLocation();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();

  return resolveRailNavPanelKey(pathname, activeWorkspaceSlug);
};

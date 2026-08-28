import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useActiveLocation } from '@/hooks/useActiveLocation';

import { resolveNavPanelKey } from './routeKey';

export const useActiveNavKey = () => {
  const { pathname } = useActiveLocation();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();

  return resolveNavPanelKey(pathname, activeWorkspaceSlug);
};

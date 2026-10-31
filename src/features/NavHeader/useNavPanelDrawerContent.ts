import { type ReactNode, useSyncExternalStore } from 'react';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import {
  getNavPanelRegistrySnapshot,
  subscribeNavPanelRegistry,
} from '@/features/NavPanel/registry';
import { resolveNavPanelKey } from '@/features/NavPanel/routeKey';
import { useActiveLocation } from '@/hooks/useActiveLocation';

/**
 * The sidebar the active route registered through `NavPanelPortal`, for the
 * mobile drawer. `home` is the desktop agent list, which mobile already shows
 * as its home page, so it never opens as a drawer.
 *
 * Mobile keeps the per-route sidebars (agent topics, group members), so it
 * resolves with the legacy mapping rather than the desktop rail one.
 */
export const useNavPanelDrawerContent = (): ReactNode | undefined => {
  const { pathname } = useActiveLocation();
  const navKey = resolveNavPanelKey(pathname, useActiveWorkspaceSlug());

  const getContent = () =>
    navKey === 'home' ? undefined : getNavPanelRegistrySnapshot().get(navKey)?.node;

  return useSyncExternalStore(subscribeNavPanelRegistry, getContent, getContent);
};

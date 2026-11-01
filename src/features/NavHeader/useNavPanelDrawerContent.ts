import { type ReactNode, useSyncExternalStore } from 'react';

import {
  getNavPanelRegistrySnapshot,
  subscribeNavPanelRegistry,
} from '@/features/NavPanel/registry';
import { useActiveNavKey } from '@/features/NavPanel/useActiveNavKey';

/**
 * The sidebar the active route registered through `NavPanelPortal`, for the
 * mobile drawer. `home` is the desktop agent list, which mobile already shows
 * as its home page, so it never opens as a drawer.
 */
export const useNavPanelDrawerContent = (): ReactNode | undefined => {
  const navKey = useActiveNavKey();

  const getContent = () =>
    navKey === 'home' ? undefined : getNavPanelRegistrySnapshot().get(navKey)?.node;

  return useSyncExternalStore(subscribeNavPanelRegistry, getContent, getContent);
};

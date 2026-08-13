'use client';

import { memo, type PropsWithChildren, useLayoutEffect } from 'react';

import { useSingleton } from '@/hooks/useSingleton';

import { registerNavPanelContent, unregisterNavPanelContent } from './registry';

interface NavPanelPortalProps extends PropsWithChildren {
  /**
   * Stable route-owned key used by NavPanelHost to select the active content.
   * @example <NavPanelPortal navKey="agent">...</NavPanelPortal>
   */
  navKey?: string;
}

export const NavPanelPortal = memo<NavPanelPortalProps>(({ children, navKey = 'default' }) => {
  const owner = useSingleton(() => Symbol('NavPanelPortal'));

  useLayoutEffect(() => {
    if (!children) return;

    registerNavPanelContent(navKey, owner, children);

    return () => {
      unregisterNavPanelContent(navKey, owner);
    };
  }, [children, navKey, owner]);

  return null;
});

NavPanelPortal.displayName = 'NavPanelPortal';

export default NavPanelPortal;

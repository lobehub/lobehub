'use client';

import { memo, type PropsWithChildren, useLayoutEffect, useRef } from 'react';

import { registerNavPanelContent, unregisterNavPanelContent } from './registry';

interface NavPanelPortalProps extends PropsWithChildren {
  /**
   * Stable route-owned key used by NavPanelHost to select the active content.
   * @example <NavPanelPortal navKey="agent">...</NavPanelPortal>
   */
  navKey?: string;
}

export const NavPanelPortal = memo<NavPanelPortalProps>(({ children, navKey = 'default' }) => {
  const ownerRef = useRef(Symbol('NavPanelPortal'));

  useLayoutEffect(() => {
    if (!children) return;
    const owner = ownerRef.current;

    registerNavPanelContent(navKey, owner, children);

    return () => {
      unregisterNavPanelContent(navKey, owner);
    };
  }, [children, navKey]);

  return null;
});

NavPanelPortal.displayName = 'NavPanelPortal';

export default NavPanelPortal;

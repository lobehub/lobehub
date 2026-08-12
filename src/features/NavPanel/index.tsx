'use client';

import { memo, useSyncExternalStore } from 'react';

import { NavPanelDraggable } from './components/NavPanelDraggable';
import {
  DEFAULT_NAV_SKELETON_SHAPE,
  NAV_SKELETON_SHAPES,
  NavSideBarSkeleton,
} from './components/SideBarSkeleton';
import { NAV_PANEL_RIGHT_DRAWER_ID } from './constants';
import { getNavPanelRegistrySnapshot, subscribeNavPanelRegistry } from './registry';
import { useActiveNavKey } from './useActiveNavKey';

const NavPanelFallback = memo<{ navKey: string }>(({ navKey }) => (
  <NavSideBarSkeleton {...(NAV_SKELETON_SHAPES[navKey] ?? DEFAULT_NAV_SKELETON_SHAPE)} />
));

const NavPanel = memo(() => {
  const activeNavKey = useActiveNavKey();
  const registry = useSyncExternalStore(
    subscribeNavPanelRegistry,
    getNavPanelRegistrySnapshot,
    getNavPanelRegistrySnapshot,
  );
  const registeredContent = registry.get(activeNavKey);
  const activeContent = registeredContent
    ? { key: activeNavKey, node: registeredContent.node }
    : { key: `pending:${activeNavKey}`, node: <NavPanelFallback navKey={activeNavKey} /> };

  return (
    <>
      <NavPanelDraggable activeContent={activeContent} />
      <div
        id={NAV_PANEL_RIGHT_DRAWER_ID}
        style={{
          height: '100%',
          position: 'relative',
          width: 0,
          zIndex: 10,
        }}
      />
    </>
  );
});

NavPanel.displayName = 'NavPanel';

export { NavPanelPortal } from './NavPanelPortal';
export { useActiveNavKey } from './useActiveNavKey';
export default NavPanel;

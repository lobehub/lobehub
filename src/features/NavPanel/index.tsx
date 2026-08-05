'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useSyncExternalStore } from 'react';

import { NavPanelDraggable } from './components/NavPanelDraggable';
import SkeletonList from './components/SkeletonList';
import { NAV_PANEL_RIGHT_DRAWER_ID } from './constants';
import { getNavPanelRegistrySnapshot, subscribeNavPanelRegistry } from './registry';
import { useActiveNavKey } from './useActiveNavKey';

const NavPanelFallback = memo(() => (
  <Flexbox gap={1} paddingBlock={1} paddingInline={4}>
    <SkeletonList rows={8} />
  </Flexbox>
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
    : { key: `pending:${activeNavKey}`, node: <NavPanelFallback /> };

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

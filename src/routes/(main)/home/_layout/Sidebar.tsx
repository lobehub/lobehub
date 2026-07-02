import { memo } from 'react';
import { useLocation } from 'react-router';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { NavPanelPortal } from '@/features/NavPanel';

import SidebarContent from './SidebarContent';

const Sidebar = memo(() => {
  const { pathname } = useLocation();
  const activeSlug = useActiveWorkspaceSlug();

  // DesktopHomeLayout stays mounted via React 19 <Activity> on non-home routes,
  // so this Sidebar also stays mounted. Without this gate, its NavPanelPortal
  // would keep racing the active route's portal (e.g. workspace settings) for
  // the global snapshot and could overwrite it on re-render.
  const isHomeRoute =
    pathname === '/' ||
    (!!activeSlug && (pathname === `/${activeSlug}` || pathname === `/${activeSlug}/`));

  if (!isHomeRoute) return null;

  return (
    <NavPanelPortal navKey="home">
      <SidebarContent />
    </NavPanelPortal>
  );
});

export default Sidebar;

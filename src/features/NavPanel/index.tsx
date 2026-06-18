'use client';

import { type PropsWithChildren, type ReactNode } from 'react';
import { memo, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import WorkspaceSettingsSideBarContent from '@/features/WorkspaceSetting/SideBar/Content';
import AgentSidebarContent from '@/routes/(main)/agent/_layout/Sidebar/Content';
import CommunitySidebarContent from '@/routes/(main)/community/_layout/Sidebar/Content';
import GroupSidebarContent from '@/routes/(main)/group/_layout/Sidebar/Content';
import SidebarContent from '@/routes/(main)/home/_layout/SidebarContent';
import SettingsSidebarContent from '@/routes/(main)/settings/_layout/SidebarContent';

import { NavPanelDraggable } from './components/NavPanelDraggable';

export const NAV_PANEL_RIGHT_DRAWER_ID = 'nav-panel-drawer';

type NavPanelSnapshot = {
  key: string;
  node: ReactNode;
} | null;

let currentSnapshot: NavPanelSnapshot = null;
const listeners = new Set<() => void>();

const subscribeNavPanel = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getNavPanelSnapshot = () => currentSnapshot;
const setNavPanelSnapshot = (snapshot: NavPanelSnapshot) => {
  currentSnapshot = snapshot;
  listeners.forEach((listener) => listener());
};

export const resetNavPanel = () => {
  if (!currentSnapshot) return;

  setNavPanelSnapshot(null);
};

const FALLBACK_NAV_KEY = 'home';
const AGENT_NAV_KEY = 'agent';
const GROUP_NAV_KEY = 'group';
const COMMUNITY_NAV_KEY = 'discover';
const EMPTY_NAV_KEY = 'empty';
const SETTINGS_NAV_KEY = 'settings';
const WORKSPACE_SETTINGS_NAV_KEY = 'workspace-settings';

const DEDICATED_ROUTE_NAV_SEGMENTS = new Set([
  'community',
  'eval',
  'fleet',
  'group',
  'image',
  'memory',
  'page',
  'resource',
  'video',
]);

const getActiveNavKey = () => currentSnapshot?.key ?? FALLBACK_NAV_KEY;

export const useActiveNavKey = () =>
  useSyncExternalStore(subscribeNavPanel, getActiveNavKey, getActiveNavKey);

const getMainRouteSegment = (pathname: string, activeSlug: string | null) => {
  const segments = pathname.split('/').filter(Boolean);
  if (activeSlug && segments[0] === activeSlug) return segments[1];
  return segments[0];
};

const NavPanel = memo(() => {
  const { pathname } = useLocation();
  const activeSlug = useActiveWorkspaceSlug();
  const panelContent = useSyncExternalStore(
    subscribeNavPanel,
    getNavPanelSnapshot,
    getNavPanelSnapshot,
  );

  const isWorkspaceSettingsRoute =
    !!activeSlug &&
    (pathname === `/${activeSlug}/settings` || pathname.startsWith(`/${activeSlug}/settings/`));
  const isHomeRoute =
    pathname === '/' ||
    (!!activeSlug && (pathname === `/${activeSlug}` || pathname === `/${activeSlug}/`));
  const isPersonalSettingsRoute = pathname === '/settings' || pathname.startsWith('/settings/');
  const isWorkspaceAgentRoute =
    !!activeSlug &&
    (pathname === `/${activeSlug}/agent` || pathname.startsWith(`/${activeSlug}/agent/`));
  const isPersonalAgentRoute = pathname === '/agent' || pathname.startsWith('/agent/');
  const isWorkspaceGroupRoute =
    !!activeSlug &&
    (pathname === `/${activeSlug}/group` || pathname.startsWith(`/${activeSlug}/group/`));
  const isPersonalGroupRoute = pathname === '/group' || pathname.startsWith('/group/');

  const agentFallback =
    isWorkspaceAgentRoute || isPersonalAgentRoute
      ? {
          key: AGENT_NAV_KEY,
          node: <AgentSidebarContent />,
        }
      : null;

  const groupFallback =
    isWorkspaceGroupRoute || isPersonalGroupRoute
      ? {
          key: GROUP_NAV_KEY,
          node: <GroupSidebarContent />,
        }
      : null;

  const workspaceSettingsFallback = isWorkspaceSettingsRoute
    ? {
        key: WORKSPACE_SETTINGS_NAV_KEY,
        node: <WorkspaceSettingsSideBarContent />,
      }
    : null;
  const personalSettingsFallback = isPersonalSettingsRoute
    ? {
        key: SETTINGS_NAV_KEY,
        node: <SettingsSidebarContent />,
      }
    : null;
  const mainRouteSegment = getMainRouteSegment(pathname, activeSlug);
  const communityFallback =
    mainRouteSegment === 'community'
      ? {
          key: COMMUNITY_NAV_KEY,
          node: <CommunitySidebarContent />,
        }
      : null;
  const routeFallback =
    agentFallback ||
    groupFallback ||
    workspaceSettingsFallback ||
    personalSettingsFallback ||
    communityFallback;
  const hasDedicatedRouteNavPanel = DEDICATED_ROUTE_NAV_SEGMENTS.has(mainRouteSegment ?? '');
  const isStaleHomeSnapshot =
    panelContent?.key === FALLBACK_NAV_KEY && hasDedicatedRouteNavPanel && !isHomeRoute;

  const resolvedPanelContent =
    routeFallback && panelContent?.key === FALLBACK_NAV_KEY
      ? routeFallback
      : isStaleHomeSnapshot
        ? null
        : panelContent;

  // Fallback renders the home sidebar's content directly — using `<Sidebar />`
  // (the portal wrapper) here loops with the portal's unmount cleanup:
  // mount fallback → portal sets snapshot → fallback unmounts → cleanup
  // clears snapshot → mount fallback → …
  const activeContent =
    resolvedPanelContent ||
    routeFallback ||
    (isHomeRoute || !hasDedicatedRouteNavPanel
      ? ({ key: FALLBACK_NAV_KEY, node: <SidebarContent /> } satisfies NavPanelSnapshot)
      : ({ key: EMPTY_NAV_KEY, node: null } satisfies NavPanelSnapshot));

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

export default NavPanel;

interface NavPanelPortalProps extends PropsWithChildren {
  /**
   * Unique key to trigger transition animation when content changes
   * @example <NavPanelPortal navKey="chat">...</NavPanelPortal>
   */
  navKey?: string;
}

export const NavPanelPortal = memo<NavPanelPortalProps>(({ children, navKey = 'default' }) => {
  const navKeyRef = useRef(navKey);
  navKeyRef.current = navKey;

  useLayoutEffect(() => {
    if (!children) return;

    setNavPanelSnapshot({
      key: navKey,
      node: children,
    });
  }, [children, navKey]);

  // Clear the snapshot on unmount if this portal still owns it. Without this,
  // a route transition where the next layout's portal effect doesn't fire in
  // the same commit (concurrent transitions, lazy boundaries, Fragment-key
  // remounts) leaves the previous owner's snapshot in place — visible as a
  // stale sidebar that may render empty under its new state (e.g. workspace
  // settings sidebar after the active workspace is deleted).
  useLayoutEffect(
    () => () => {
      if (currentSnapshot?.key === navKeyRef.current) {
        setNavPanelSnapshot(null);
      }
    },
    [],
  );

  return null;
});

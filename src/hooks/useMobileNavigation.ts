import { useLocation, useParams } from 'react-router';

import { MARKETPLACE_SEGMENT } from '@/features/Marketplace/paths';
import { SidebarTabKey } from '@/store/global/initialState';

const MOBILE_NAV_ROUTES = new Set([
  '/',
  '/marketplace',
  '/marketplace/agent',
  '/marketplace/connector',
  '/marketplace/app',
  '/marketplace/mcp',
  '/marketplace/model',
  '/marketplace/provider',
  '/marketplace/skill',
  '/me',
]);

/** Resolve navigation against the page within the matched workspace, not its slug. */
export const useMobileNavigation = () => {
  const { pathname } = useLocation();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const pagePathname = workspaceSlug ? pathname.slice(workspaceSlug.length + 1) || '/' : pathname;
  const normalizedPathname = pagePathname.replace(/\/+$/, '') || '/';
  const firstSegment = normalizedPathname.split('/').find(Boolean);
  // The Marketplace kept its `community` tab key when its URL moved to `/marketplace`.
  const activeKey =
    firstSegment === MARKETPLACE_SEGMENT
      ? SidebarTabKey.Community
      : (firstSegment as SidebarTabKey) || SidebarTabKey.Chat;

  return { activeKey, showNav: MOBILE_NAV_ROUTES.has(normalizedPathname) };
};

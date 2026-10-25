import { useLocation, useParams } from 'react-router';

import { SidebarTabKey } from '@/store/global/initialState';

const MOBILE_NAV_ROUTES = new Set([
  '/',
  '/community',
  '/community/agent',
  '/community/mcp',
  '/community/plugin',
  '/community/model',
  '/community/provider',
  '/me',
]);

/** Resolve navigation against the page within the matched workspace, not its slug. */
export const useMobileNavigation = () => {
  const { pathname } = useLocation();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const pagePathname = workspaceSlug ? pathname.slice(workspaceSlug.length + 1) || '/' : pathname;
  const normalizedPathname = pagePathname.replace(/\/+$/, '') || '/';
  const activeKey =
    (normalizedPathname.split('/').find(Boolean) as SidebarTabKey) || SidebarTabKey.Chat;

  return { activeKey, showNav: MOBILE_NAV_ROUTES.has(normalizedPathname) };
};

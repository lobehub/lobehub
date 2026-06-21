import { getWorkspaceNormalizedPathname } from '@/hooks/useActiveTabKey';

const MOBILE_NAV_ROUTES = new Set([
  '/',
  '/agent',
  '/community',
  '/community/agent',
  '/community/mcp',
  '/community/plugin',
  '/community/model',
  '/community/provider',
  '/me',
]);

export const shouldShowMobileNav = (pathname: string, activeWorkspaceSlug?: string) => {
  const normalizedPathname = getWorkspaceNormalizedPathname(pathname, activeWorkspaceSlug);

  return MOBILE_NAV_ROUTES.has(normalizedPathname) || normalizedPathname.startsWith('/agent/');
};

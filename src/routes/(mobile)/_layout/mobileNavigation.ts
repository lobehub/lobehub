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

export const shouldShowMobileNav = (pathname: string, activeWorkspaceSlug?: string | null) => {
  const normalizedPathname = getWorkspaceNormalizedPathname(
    pathname,
    activeWorkspaceSlug ?? undefined,
  );

  return MOBILE_NAV_ROUTES.has(normalizedPathname);
};

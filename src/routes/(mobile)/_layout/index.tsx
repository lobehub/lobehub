'use client';

import { type FC } from 'react';
import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import WorkspaceContextSlot from '@/business/client/WorkspaceContextSlot';
import Loading from '@/components/Loading/BrandTextLoading';
import { RouteMetaBridge } from '@/features/RouteMeta';
import dynamic from '@/libs/next/dynamic';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import NavBar from './NavBar';

const CloudBanner = dynamic(() => import('@/features/AlertBanner/CloudBanner'));
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

export const normalizeMobileNavPathname = (pathname: string, activeSlug?: string | null) => {
  if (!activeSlug) return pathname || '/';

  const activeSlugPrefix = `/${activeSlug}`;

  if (pathname === activeSlugPrefix) return '/';

  if (!pathname.startsWith(`${activeSlugPrefix}/`)) return pathname || '/';

  return pathname.slice(activeSlugPrefix.length) || '/';
};

export const shouldShowMobileNav = (pathname: string, activeSlug?: string | null) =>
  MOBILE_NAV_ROUTES.has(normalizeMobileNavPathname(pathname, activeSlug));

const MobileMainLayout: FC = () => {
  const { showCloudPromotion } = useServerConfigStore(featureFlagsSelectors);
  const location = useLocation();
  const activeSlug = useActiveWorkspaceSlug();
  const pathname = location.pathname;
  const showNav = shouldShowMobileNav(pathname, activeSlug);
  return (
    <WorkspaceContextSlot>
      <RouteMetaBridge />
      <Suspense fallback={null}>{showCloudPromotion && <CloudBanner mobile />}</Suspense>
      <Suspense fallback={<Loading debugId="MobileMainLayout > Outlet" />}>
        <Outlet />
        {showNav && <NavBar />}
      </Suspense>
    </WorkspaceContextSlot>
  );
};

export default MobileMainLayout;

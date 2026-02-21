'use client';

import { type FC } from 'react';
import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import { MarketAuthProvider } from '@/layout/AuthProvider/MarketAuth';
import dynamic from '@/libs/next/dynamic';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { NavigatorRegistrar } from '@/utils/router';

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

const MobileMainLayout: FC = () => {
  const { showCloudPromotion } = useServerConfigStore(featureFlagsSelectors);
  const location = useLocation();
  const pathname = location.pathname;
  const showNav = MOBILE_NAV_ROUTES.has(pathname);
  return (
    <>
      <NavigatorRegistrar />
      <Suspense fallback={null}>{showCloudPromotion && <CloudBanner mobile />}</Suspense>
      <MarketAuthProvider isDesktop={false}>
        <Suspense fallback={<Loading debugId="MobileMainLayout > Outlet" />}>
          <Outlet />
          {showNav && <NavBar />}
        </Suspense>
      </MarketAuthProvider>
    </>
  );
};

export default MobileMainLayout;

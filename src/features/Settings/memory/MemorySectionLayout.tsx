'use client';

import { Flexbox } from '@lobehub/ui';
import { Outlet } from 'react-router';

import { RouteSkeletonChromeProvider } from '@/spa/router/routeSkeletonChrome';

/** Frame of the memory pages inside Settings; each page draws its own header and scroll. */
const MemorySectionLayout = () => (
  <Flexbox flex={1} height={'100%'} style={{ overflow: 'hidden', position: 'relative' }}>
    <RouteSkeletonChromeProvider>
      <Outlet />
    </RouteSkeletonChromeProvider>
  </Flexbox>
);

export default MemorySectionLayout;

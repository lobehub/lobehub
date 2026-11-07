import { Outlet } from 'react-router';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import Footer from '@/features/Setting/Footer';
import { SCROLL_PARENT_ID } from '@/routes/(main)/community/features/const';
import { RouteSkeletonChromeProvider } from '@/spa/router/routeSkeletonChrome';

import Header from './Header';

const Layout = () => {
  return (
    <MobileContentLayout gap={16} header={<Header />} id={SCROLL_PARENT_ID} padding={16}>
      <RouteSkeletonChromeProvider>
        <Outlet />
      </RouteSkeletonChromeProvider>
      <div />
      <Footer />
    </MobileContentLayout>
  );
};

export default Layout;

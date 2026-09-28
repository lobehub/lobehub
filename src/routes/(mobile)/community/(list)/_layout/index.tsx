import { Outlet } from 'react-router';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import Footer from '@/features/Setting/Footer';
import { RouteSkeletonChromeProvider } from '@/spa/router/routeSkeletonChrome';

import { SCROLL_PARENT_ID } from '../../../../(main)/community/features/const';
import Header from './Header';
import { styles } from './style';

const Layout = () => {
  return (
    <MobileContentLayout
      withNav
      className={styles.mainContainer}
      gap={16}
      header={<Header />}
      id={SCROLL_PARENT_ID}
    >
      <RouteSkeletonChromeProvider>
        <Outlet />
      </RouteSkeletonChromeProvider>
      <div />
      <Footer />
    </MobileContentLayout>
  );
};

export default Layout;

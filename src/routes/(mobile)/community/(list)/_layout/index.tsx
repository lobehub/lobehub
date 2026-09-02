import { Outlet } from 'react-router';
import { SWRConfig } from 'swr';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import SuspenseRouteBoundary from '@/components/SuspenseRouteBoundary';
import Footer from '@/features/Setting/Footer';

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
      <SWRConfig value={{ suspense: true }}>
        <SuspenseRouteBoundary>
          <Outlet />
        </SuspenseRouteBoundary>
      </SWRConfig>
      <div />
      <Footer />
    </MobileContentLayout>
  );
};

export default Layout;

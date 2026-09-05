import { Outlet } from 'react-router';
import { SWRConfig } from 'swr';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import SuspenseRouteBoundary from '@/components/SuspenseRouteBoundary';
import Footer from '@/features/Setting/Footer';
import { SCROLL_PARENT_ID } from '@/routes/(main)/community/features/const';

import Header from './Header';

const Layout = () => {
  return (
    <MobileContentLayout gap={16} header={<Header />} id={SCROLL_PARENT_ID} padding={16}>
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

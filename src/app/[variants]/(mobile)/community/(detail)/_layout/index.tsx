import { Outlet } from 'react-router-dom';

import { SCROLL_PARENT_ID } from '@/app/[variants]/(main)/community/features/const';
import MobileContentLayout from '@/components/server/MobileNavLayout';
import Footer from '@/features/Setting/Footer';

import Header from './Header';

const Layout = () => {
  return (
    <MobileContentLayout gap={16} header={<Header />} id={SCROLL_PARENT_ID} padding={16}>
      <Outlet />
      <div />
      <Footer />
    </MobileContentLayout>
  );
};

Layout.displayName = 'MobileDiscoverDetailLayout';

export default Layout;

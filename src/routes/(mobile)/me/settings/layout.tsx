import { Outlet } from 'react-router';

import MobileContentLayout from '@/components/server/MobileNavLayout';

import Header from './features/Header';

const Layout = () => {
  return (
    <MobileContentLayout withNav header={<Header />}>
      <Outlet />
    </MobileContentLayout>
  );
};

export default Layout;

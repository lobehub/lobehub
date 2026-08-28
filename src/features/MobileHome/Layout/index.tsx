import { type FC } from 'react';
import { Outlet } from 'react-router';

import MobileLayout from '@/features/MobileHome/Layout/MobileLayout';
import SessionHydration from '@/features/MobileHome/Layout/SessionHydration';

const Layout: FC = () => {
  return (
    <>
      <MobileLayout>
        <Outlet />
      </MobileLayout>
      <SessionHydration />
    </>
  );
};

export default Layout;

import { type FC } from 'react';
import { Outlet } from 'react-router-dom';

import MobileLayout from '@/app/[variants]/(mobile)/(home)/_layout/MobileLayout';
import SessionHydration from '@/app/[variants]/(mobile)/(home)/_layout/SessionHydration';

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

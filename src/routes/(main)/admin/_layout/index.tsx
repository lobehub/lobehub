'use client';

import { type FC, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';

import { AdminLayout } from '@/features/Admin';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const Layout: FC = () => {
  const navigate = useNavigate();
  const isLoaded = useUserStore(authSelectors.isLoaded);
  const isAdmin = useUserStore(authSelectors.isAdmin);

  useEffect(() => {
    // Wait for session to load before redirecting
    if (isLoaded && !isAdmin) {
      navigate('/', { replace: true });
    }
  }, [isLoaded, isAdmin, navigate]);

  // Don't render admin layout until we know the user is an admin
  if (!isLoaded || !isAdmin) return null;

  return (
    <AdminLayout>
      <Outlet />
    </AdminLayout>
  );
};

export default Layout;

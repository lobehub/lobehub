'use client';

import { Outlet, useParams } from 'react-router';

import ProviderMenu from '@/features/Settings/provider/ProviderMenu';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

const Layout = () => {
  const params = useParams<{ providerId: string }>();
  const navigate = useWorkspaceAwareNavigate();

  const handleProviderSelect = (providerKey: string) => {
    navigate(`/settings/provider/${providerKey}`);
  };

  return params.providerId === 'all' ? (
    <ProviderMenu mobile={true} onProviderSelect={handleProviderSelect} />
  ) : (
    <Outlet />
  );
};

export default Layout;

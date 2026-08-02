'use client';

import { Outlet, useParams } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';

import ProviderMenu from '../../../../(main)/settings/provider/ProviderMenu';

const Layout = () => {
  const params = useParams<{ providerId: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const { data: managedStatus } = useClientDataSWR('aico-provider-status', () =>
    lambdaClient.aicoBilling.getManagedProviderStatus.query(),
  );
  const aicoManaged = managedStatus?.managed ?? true;

  const handleProviderSelect = (providerKey: string) => {
    navigate(`/settings/provider/${providerKey}`);
  };

  // Managed mode: skip the list panel and always show provider detail.
  if (aicoManaged) return <Outlet />;

  return params.providerId === 'all' ? (
    <ProviderMenu mobile={true} onProviderSelect={handleProviderSelect} />
  ) : (
    <Outlet />
  );
};

export default Layout;

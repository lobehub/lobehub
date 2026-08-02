'use client';

import { type PropsWithChildren } from 'react';
import { useSearchParams } from 'react-router';

import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';

import ProviderMenu from '../ProviderMenu';

interface LayoutProps extends PropsWithChildren {
  onProviderSelect: (providerKey: string) => void;
}

const Layout = ({ children, onProviderSelect }: LayoutProps) => {
  const [searchParams] = useSearchParams();
  const provider = searchParams.get('provider');
  const { data: managedStatus } = useClientDataSWR('aico-provider-status', () =>
    lambdaClient.aicoBilling.getManagedProviderStatus.query(),
  );
  const aicoManaged = managedStatus?.managed ?? true;

  // Managed mode: no list panel — always show the Aico provider detail.
  if (aicoManaged) return children;

  return provider === 'all' || !provider ? (
    <ProviderMenu mobile={true} onProviderSelect={onProviderSelect} />
  ) : (
    children
  );
};

export default Layout;

'use client';

import type {PropsWithChildren} from 'react';
import { useSearchParams } from 'react-router-dom';

import ProviderMenu from '../ProviderMenu';

interface LayoutProps extends PropsWithChildren {
  onProviderSelect: (providerKey: string) => void;
}

const Layout = ({ children, onProviderSelect }: LayoutProps) => {
  const [searchParams] = useSearchParams();
  const provider = searchParams.get('provider');
  return provider === 'all' || !provider ? (
    <ProviderMenu mobile={true} onProviderSelect={onProviderSelect} />
  ) : (
    children
  );
};

export default Layout;

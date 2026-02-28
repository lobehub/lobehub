'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { isCustomBranding } from '@/const/version';

import DesktopLayout from '../_layout/Desktop';
import MobileLayout from '../_layout/Mobile';
import ProviderDetailPage from '../detail';
import Footer from './Footer';

const Page = (props: { mobile?: boolean }) => {
  const [SearchParams, setSearchParams] = useSearchParams();
  const [provider, setProviderState] = useState(SearchParams.get('provider') || 'all');
  const setProvider = (provider: string) => {
    setSearchParams({ active: 'provider', provider });
    setProviderState(provider);
  };

  const { mobile } = props;
  const ProviderLayout = mobile ? MobileLayout : DesktopLayout;

  const ProviderListPage = useMemo(() => {
    return <ProviderDetailPage id={provider} onProviderSelect={setProvider} />;
  }, [provider]);

  return (
    <ProviderLayout onProviderSelect={setProvider}>
      {ProviderListPage}
      {!isCustomBranding && <Footer />}
    </ProviderLayout>
  );
};

export default Page;

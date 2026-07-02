'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Outlet, useParams } from 'react-router';

import { isCustomBranding } from '@/const/version';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import DesktopLayoutContainer from './_layout/Desktop/Container';
import Footer from './(list)/Footer';
import ProviderDetailPageComponent from './detail';
import ProviderMenu from './ProviderMenu';

// Layout component that wraps provider pages with navigation
export const ProviderLayout = memo(() => {
  const navigate = useWorkspaceAwareNavigate();

  const handleProviderSelect = (providerKey: string) => {
    navigate(`/settings/provider/${providerKey}`);
  };

  return (
    <Flexbox
      horizontal
      width={'100%'}
      style={{
        maxHeight: '100%',
      }}
    >
      <ProviderMenu mobile={false} onProviderSelect={handleProviderSelect} />
      <DesktopLayoutContainer>
        <Outlet />
        {!isCustomBranding && <Footer />}
      </DesktopLayoutContainer>
    </Flexbox>
  );
});

ProviderLayout.displayName = 'ProviderLayout';

// Detail page component that receives providerId from route params
export const ProviderDetailPage = memo(() => {
  const params = useParams<{ providerId: string }>();
  const navigate = useWorkspaceAwareNavigate();

  const handleProviderSelect = (providerKey: string) => {
    navigate(`/settings/provider/${providerKey}`);
  };

  return (
    <ProviderDetailPageComponent
      id={params.providerId ?? ''}
      onProviderSelect={handleProviderSelect}
    />
  );
});

ProviderDetailPage.displayName = 'ProviderDetailPage';

// Default export for backward compatibility (used by SettingsContent)
type ProviderPageType = {
  mobile?: boolean;
};

const ProviderPage = (props: ProviderPageType) => {
  const { mobile } = props;

  // For mobile or when used via SettingsContent, use the old Page component
  // This is a fallback for non-router usage
  const OldPage = require('./(list)').default;
  return <OldPage mobile={mobile} />;
};

export default ProviderPage;

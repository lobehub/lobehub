'use client';

import { memo, useMemo } from 'react';
import { Outlet } from 'react-router';

import MobileContentLayout from '@/components/server/MobileNavLayout';

import SettingsContextProvider from '../../../(main)/settings/_layout/ContextProvider';
import Header from './Header';

const MobileSettingsWrapper = memo(() => {
  const contextValue = useMemo(
    () => ({ showOpenAIApiKey: true, showOpenAIProxyUrl: true }),
    [],
  );

  return (
    <SettingsContextProvider value={contextValue}>
      <MobileContentLayout header={<Header />}>
        <Outlet />
      </MobileContentLayout>
    </SettingsContextProvider>
  );
});

MobileSettingsWrapper.displayName = 'MobileSettingsWrapper';

export default MobileSettingsWrapper;

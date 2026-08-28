'use client';

import { Outlet } from 'react-router';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import SettingsContextProvider from '@/features/Settings/Layout/ContextProvider';

import Header from './Header';

const MobileSettingsWrapper = () => {
  return (
    <SettingsContextProvider
      value={{
        showOpenAIApiKey: true,
        showOpenAIProxyUrl: true,
      }}
    >
      <MobileContentLayout header={<Header />}>
        <Outlet />
      </MobileContentLayout>
    </SettingsContextProvider>
  );
};

export default MobileSettingsWrapper;

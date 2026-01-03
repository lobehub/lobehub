'use client';

import { memo } from 'react';
import { Outlet } from 'react-router-dom';

import SettingsContextProvider from '../../../(main)/settings/_layout/ContextProvider';

const MobileSettingsWrapper = memo(() => {
  return (
    <SettingsContextProvider
      value={{
        showOpenAIApiKey: true,
        showOpenAIProxyUrl: true,
      }}
    >
      <Outlet />
    </SettingsContextProvider>
  );
});

MobileSettingsWrapper.displayName = 'MobileSettingsWrapper';

export default MobileSettingsWrapper;

'use client';

import SettingsContextProvider from '@/routes/(main)/settings/_layout/ContextProvider';
import Page from '@/routes/(main)/settings/provider/(list)';

const WorkspaceProviderSetting = () => (
  <SettingsContextProvider
    value={{
      showOpenAIApiKey: true,
      showOpenAIProxyUrl: true,
    }}
  >
    <Page />
  </SettingsContextProvider>
);

WorkspaceProviderSetting.displayName = 'WorkspaceProviderSetting';

export default WorkspaceProviderSetting;

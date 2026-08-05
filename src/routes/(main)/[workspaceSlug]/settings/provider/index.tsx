'use client';

import WorkspaceAdminOnly from '@/features/WorkspaceSetting/AdminOnly';
import SettingsContextProvider from '@/routes/(main)/settings/_layout/ContextProvider';
import Page from '@/routes/(main)/settings/provider/(list)';

const WorkspaceProviderSetting = () => (
  <WorkspaceAdminOnly>
    <SettingsContextProvider
      value={{
        showOpenAIApiKey: true,
        showOpenAIProxyUrl: true,
      }}
    >
      <Page />
    </SettingsContextProvider>
  </WorkspaceAdminOnly>
);

WorkspaceProviderSetting.displayName = 'WorkspaceProviderSetting';

export default WorkspaceProviderSetting;

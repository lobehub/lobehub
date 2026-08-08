'use client';

import SettingsContextProvider from '@/features/Settings/Layout/ContextProvider';
import Page from '@/features/Settings/provider/(list)';
import WorkspaceAdminOnly from '@/features/WorkspaceSetting/AdminOnly';

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

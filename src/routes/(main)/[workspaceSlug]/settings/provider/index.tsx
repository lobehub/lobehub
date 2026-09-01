'use client';

import SettingsContextProvider from '@/features/Settings/Layout/ContextProvider';
import Page from '@/features/Settings/provider/(list)';
import WorkspaceAdminOnly from '@/features/WorkspaceSetting/AdminOnly';

const WorkspaceProviderSetting = ({ mobile }: { mobile?: boolean }) => (
  <WorkspaceAdminOnly>
    <SettingsContextProvider
      value={{
        showOpenAIApiKey: true,
        showOpenAIProxyUrl: true,
      }}
    >
      <Page mobile={mobile} />
    </SettingsContextProvider>
  </WorkspaceAdminOnly>
);

WorkspaceProviderSetting.displayName = 'WorkspaceProviderSetting';

export const WorkspaceProviderSettingMobile = () => <WorkspaceProviderSetting mobile />;

WorkspaceProviderSettingMobile.displayName = 'WorkspaceProviderSettingMobile';

export default WorkspaceProviderSetting;

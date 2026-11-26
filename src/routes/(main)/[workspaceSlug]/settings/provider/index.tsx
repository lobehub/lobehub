'use client';

import { WorkspaceProviderGuard } from '@/business/client/BusinessSettingPages/WorkspaceProviderGuard';
import SettingsContextProvider from '@/features/Settings/Layout/ContextProvider';
import Page from '@/features/Settings/provider/(list)';
import WorkspaceAdminOnly from '@/features/WorkspaceSetting/AdminOnly';

const WorkspaceProviderSetting = ({ mobile }: { mobile?: boolean }) => (
  <WorkspaceAdminOnly>
    <WorkspaceProviderGuard>
      <SettingsContextProvider
        value={{
          showOpenAIApiKey: true,
          showOpenAIProxyUrl: true,
        }}
      >
        <Page mobile={mobile} />
      </SettingsContextProvider>
    </WorkspaceProviderGuard>
  </WorkspaceAdminOnly>
);

WorkspaceProviderSetting.displayName = 'WorkspaceProviderSetting';

export const WorkspaceProviderSettingMobile = () => <WorkspaceProviderSetting mobile />;

WorkspaceProviderSettingMobile.displayName = 'WorkspaceProviderSettingMobile';

export default WorkspaceProviderSetting;

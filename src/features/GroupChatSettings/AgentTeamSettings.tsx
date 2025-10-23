import { Skeleton } from 'antd';
import { ReactNode, Suspense, memo } from 'react';

import { GroupSettingsTabs } from '@/store/global/initialState';
import { useServerConfigStore } from '@/store/serverConfig';

import AgentTeamChatSettings from './AgentTeamChatSettings';
import AgentTeamMembersSettings from './AgentTeamMembersSettings';
import AgentTeamMetaSettings from './AgentTeamMetaSettings';
import { GroupChatSettingsProvider } from './GroupChatSettingsProvider';
import { StoreUpdaterProps } from './StoreUpdater';

export interface AgentTeamSettingsProps extends StoreUpdaterProps {
  tab?: GroupSettingsTabs;
}

export interface AgentTeamSettingsContentProps {
  loadingSkeleton?: ReactNode;
  tab: GroupSettingsTabs;
}

const AgentTeamSettingsContent = memo<AgentTeamSettingsContentProps>(({ tab }) => {
  return (
    <>
      {tab === GroupSettingsTabs.Settings && <AgentTeamMetaSettings />}
      {tab === GroupSettingsTabs.Members && <AgentTeamMembersSettings />}
      {tab === GroupSettingsTabs.Chat && <AgentTeamChatSettings />}
    </>
  );
});

const AgentTeamSettings = memo<AgentTeamSettingsProps>(
  ({ tab = GroupSettingsTabs.Settings, ...rest }) => {
    const isMobile = useServerConfigStore((s) => s.isMobile);
    const loadingSkeleton = (
      <Skeleton
        active
        paragraph={{ rows: 6 }}
        style={{ padding: isMobile ? 16 : 0 }}
        title={false}
      />
    );

    return (
      <GroupChatSettingsProvider {...rest}>
        <Suspense fallback={loadingSkeleton}>
          <AgentTeamSettingsContent tab={tab} />
        </Suspense>
      </GroupChatSettingsProvider>
    );
  },
);

export default AgentTeamSettings;

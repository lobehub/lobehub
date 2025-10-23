'use client';

import { Drawer } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import BrandWatermark from '@/components/BrandWatermark';
import PanelTitle from '@/components/PanelTitle';
import { isDesktop } from '@/const/version';
import { TITLE_BAR_HEIGHT } from '@/features/ElectronTitlebar';
import {
  AgentTeamSettings,
  GroupCategory,
  GroupChatSettingsProvider,
} from '@/features/GroupChatSettings';
import Footer from '@/features/Setting/Footer';
import { useInitGroupConfig } from '@/hooks/useInitGroupConfig';
import { useChatGroupStore } from '@/store/chatGroup';
import { chatGroupSelectors } from '@/store/chatGroup/selectors';
import { GroupSettingsTabs } from '@/store/global/initialState';
import { useSessionStore } from '@/store/session';

const AgentTeamSettingsWrapper = memo(() => {
  const { t } = useTranslation('setting');
  const id = useSessionStore((s) => s.activeId);
  const config = useChatGroupStore(chatGroupSelectors.currentGroupConfig, isEqual);
  const meta = useChatGroupStore(chatGroupSelectors.currentGroupMeta, isEqual);
  const { isLoading } = useInitGroupConfig();

  const [showGroupSetting, updateGroupConfig, updateGroupMeta] = useChatGroupStore((s) => [
    s.showGroupSetting,
    s.updateGroupConfig,
    s.updateGroupMeta,
  ]);

  const [tab, setTab] = useState(GroupSettingsTabs.Settings);

  return (
    <GroupChatSettingsProvider
      config={config}
      id={id}
      loading={isLoading}
      meta={meta}
      onConfigChange={updateGroupConfig}
      onMetaChange={updateGroupMeta}
    >
      <Drawer
        containerMaxWidth={1280}
        height={isDesktop ? `calc(100vh - ${TITLE_BAR_HEIGHT}px)` : '100vh'}
        noHeader
        onClose={() => useChatGroupStore.setState({ showGroupSetting: false })}
        open={showGroupSetting}
        placement={'bottom'}
        sidebar={
          <Flexbox
            gap={20}
            style={{
              height: 'calc(100vh - 28px)',
            }}
          >
            <PanelTitle desc={meta?.title} title={t('header.group')} />
            <Flexbox flex={1} width={'100%'}>
              <GroupCategory setTab={setTab} tab={tab} />
            </Flexbox>
            <BrandWatermark paddingInline={12} />
          </Flexbox>
        }
        sidebarWidth={280}
        styles={{
          sidebarContent: {
            gap: 48,
            justifyContent: 'space-between',
            minHeight: isDesktop ? `calc(100% - ${TITLE_BAR_HEIGHT}px)` : '100%',
            paddingBlock: 24,
            paddingInline: 48,
          },
        }}
      >
        <AgentTeamSettings
          config={config}
          id={id}
          loading={isLoading}
          meta={meta}
          onConfigChange={updateGroupConfig}
          onMetaChange={updateGroupMeta}
          tab={tab}
        />
        <Footer />
      </Drawer>
    </GroupChatSettingsProvider>
  );
});

export default AgentTeamSettingsWrapper;

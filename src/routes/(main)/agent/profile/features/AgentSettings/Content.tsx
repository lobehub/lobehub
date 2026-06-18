'use client';

import { Avatar, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { type ItemType } from 'antd/es/menu/interface';
import { useTheme } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ActivityIcon, MessageSquareHeartIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

import Menu from '@/components/Menu';
import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { AgentSettings as Settings } from '@/features/AgentSetting';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { ChatSettingsTabs } from '@/store/global/initialState';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

const Content = memo(() => {
  const { t } = useTranslation('setting');
  const theme = useTheme();
  const { allowed: canEdit } = usePermission('edit_own_content');
  const [agentId, isInbox] = useAgentStore(
    (s) => [s.activeAgentId, builtinAgentSelectors.isInboxAgent(s)],
    shallow,
  );
  const config = useAgentStore(agentSelectors.currentAgentConfig, isEqual);
  const meta = useAgentStore(agentSelectors.currentAgentMeta, isEqual);
  const { enableAgentSelfIteration } = useServerConfigStore(featureFlagsSelectors);
  const [tab, setTab] = useState(ChatSettingsTabs.Opening);

  const availableTabs = useMemo(
    () =>
      [
        !isInbox ? ChatSettingsTabs.Opening : null,
        enableAgentSelfIteration ? ChatSettingsTabs.SelfIteration : null,
      ].filter(Boolean) as ChatSettingsTabs[],
    [isInbox, enableAgentSelfIteration],
  );

  const activeTab = availableTabs.includes(tab) ? tab : availableTabs[0];

  useEffect(() => {
    if (activeTab && activeTab !== tab) setTab(activeTab);
  }, [activeTab, tab]);

  const updateAgentConfig = async (config: any) => {
    if (!canEdit) return;
    if (!agentId) return;
    await useAgentStore.getState().optimisticUpdateAgentConfig(agentId, config);
  };

  const updateAgentMeta = async (meta: any) => {
    if (!canEdit) return;
    if (!agentId) return;
    await useAgentStore.getState().optimisticUpdateAgentMeta(agentId, meta);
  };

  const menuItems: ItemType[] = useMemo(
    () =>
      availableTabs
        .map((tab) => {
          switch (tab) {
            case ChatSettingsTabs.Opening: {
              return {
                icon: <Icon icon={MessageSquareHeartIcon} />,
                key: ChatSettingsTabs.Opening,
                label: t('agentTab.opening'),
              };
            }
            case ChatSettingsTabs.SelfIteration: {
              return {
                icon: <Icon icon={ActivityIcon} />,
                key: ChatSettingsTabs.SelfIteration,
                label: t('agentTab.selfIteration'),
              };
            }
            default: {
              return null;
            }
          }
        })
        .filter(Boolean) as ItemType[],
    [availableTabs, t],
  );

  const displayTitle = isInbox ? 'Lobe AI' : meta.title || t('defaultSession', { ns: 'common' });

  return (
    <Flexbox
      direction="horizontal"
      height="100%"
      style={{
        padding: 0,
        position: 'relative',
      }}
    >
      <Flexbox
        height={'100%'}
        paddingBlock={24}
        paddingInline={8}
        width={200}
        style={{
          background: theme.colorBgLayout,
          borderRight: `1px solid ${theme.colorBorderSecondary}`,
        }}
      >
        <Block
          horizontal
          align={'center'}
          gap={8}
          paddingBlock={'14px 16px'}
          paddingInline={4}
          variant={'borderless'}
          style={{
            overflow: 'hidden',
          }}
        >
          <Avatar
            avatar={isInbox ? DEFAULT_INBOX_AVATAR : meta.avatar || DEFAULT_AVATAR}
            background={meta.backgroundColor || undefined}
            shape={'square'}
            size={28}
          />
          <Text ellipsis weight={500}>
            {displayTitle}
          </Text>
        </Block>
        <Menu
          selectable
          items={menuItems}
          selectedKeys={activeTab ? [activeTab] : []}
          style={{ width: '100%' }}
          onClick={({ key }) => setTab(key as ChatSettingsTabs)}
        />
      </Flexbox>
      <Flexbox
        flex={1}
        paddingBlock={24}
        paddingInline={64}
        style={{ overflow: 'scroll', width: '100%' }}
      >
        {activeTab && (
          <Settings
            config={config}
            disabled={!canEdit}
            id={agentId}
            loading={false}
            meta={meta}
            tab={activeTab}
            onConfigChange={updateAgentConfig}
            onMetaChange={updateAgentMeta}
          />
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default Content;

'use client';

import { Avatar, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { type ItemType } from 'antd/es/menu/interface';
import { useTheme } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { BrainIcon, MessageSquareHeartIcon, MessagesSquareIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Menu from '@/components/Menu';
import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { AgentSettings as Settings } from '@/features/AgentSetting';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { ChatSettingsTabs } from '@/store/global/initialState';

const Content = memo(() => {
  const { t } = useTranslation('setting');
  const theme = useTheme();
  const [agentId, isInbox] = useAgentStore((s) => [
    s.activeAgentId,
    builtinAgentSelectors.isInboxAgent(s),
  ]);
  const config = useAgentStore(agentSelectors.currentAgentConfig, isEqual);
  const meta = useAgentStore(agentSelectors.currentAgentMeta, isEqual);
  const [tab, setTab] = useState(isInbox ? ChatSettingsTabs.Modal : ChatSettingsTabs.Opening);

  const updateAgentConfig = async (config: any) => {
    if (!agentId) return;
    await useAgentStore.getState().optimisticUpdateAgentConfig(agentId, config);
  };

  const updateAgentMeta = async (meta: any) => {
    if (!agentId) return;
    await useAgentStore.getState().optimisticUpdateAgentMeta(agentId, meta);
  };

  const menuItems: ItemType[] = useMemo(
    () =>
      [
        !isInbox
          ? {
              icon: <Icon icon={MessageSquareHeartIcon} />,
              key: ChatSettingsTabs.Opening,
              label: t('agentTab.opening'),
            }
          : null,
        {
          icon: <Icon icon={MessagesSquareIcon} />,
          key: ChatSettingsTabs.Chat,
          label: t('agentTab.chat'),
        },
        {
          icon: <Icon icon={BrainIcon} />,
          key: ChatSettingsTabs.Modal,
          label: t('agentTab.modal'),
        },
      ].filter(Boolean) as ItemType[],
    [t, isInbox],
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
          selectedKeys={[tab]}
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
        <Settings
          config={config}
          id={agentId}
          loading={false}
          meta={meta}
          tab={tab}
          onConfigChange={updateAgentConfig}
          onMetaChange={updateAgentMeta}
        />
      </Flexbox>
    </Flexbox>
  );
});

export default Content;

'use client';

import { Avatar, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { type ItemType } from 'antd/es/menu/interface';
import { useTheme } from 'antd-style';
import { MessageSquareHeartIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Menu from '@/components/Menu';
import { DEFAULT_AVATAR } from '@/const/meta';
import { AgentSettings as Settings } from '@/features/AgentSetting';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { ChatSettingsTabs } from '@/store/global/initialState';

const Content = memo(() => {
  const { t } = useTranslation('setting');
  const theme = useTheme();
  const groupId = useAgentGroupStore(agentGroupSelectors.activeGroupId);
  const currentGroup = useAgentGroupStore(agentGroupSelectors.currentGroup);
  const [tab] = useState(ChatSettingsTabs.Opening);

  const updateGroupConfig = async (config: any) => {
    if (!groupId) return;
    // Only update openingMessage and openingQuestions
    const groupConfig = {
      openingMessage: config.openingMessage,
      openingQuestions: config.openingQuestions,
    };
    await useAgentGroupStore.getState().updateGroupConfig(groupConfig);
  };

  const updateGroupMeta = async (meta: any) => {
    if (!groupId) return;
    await useAgentGroupStore.getState().updateGroup(groupId, meta);
  };

  // Convert group config to agent config format for AgentSettings component
  const agentConfig = useMemo(
    () =>
      ({
        chatConfig: {},
        model: '',
        openingMessage: currentGroup?.config?.openingMessage,
        openingQuestions: currentGroup?.config?.openingQuestions,
        params: {},
        systemRole: '',
        tts: {},
      }) as any,
    [currentGroup?.config],
  );

  const agentMeta = useMemo(
    () => ({
      avatar: currentGroup?.avatar || undefined,
      backgroundColor: currentGroup?.backgroundColor || undefined,
      description: currentGroup?.description || undefined,
      tags: [] as string[],
      title: currentGroup?.title || undefined,
    }),
    [currentGroup],
  );

  const menuItems: ItemType[] = useMemo(
    () => [
      {
        icon: <Icon icon={MessageSquareHeartIcon} />,
        key: ChatSettingsTabs.Opening,
        label: t('agentTab.opening'),
      },
    ],
    [t],
  );

  const displayTitle = currentGroup?.title || t('defaultSession', { ns: 'common' });

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
            avatar={currentGroup?.avatar || DEFAULT_AVATAR}
            background={currentGroup?.backgroundColor || undefined}
            shape={'square'}
            size={28}
          />
          <Text ellipsis weight={500}>
            {displayTitle}
          </Text>
        </Block>
        <Menu selectable items={menuItems} selectedKeys={[tab]} style={{ width: '100%' }} />
      </Flexbox>
      <Flexbox
        flex={1}
        paddingBlock={24}
        paddingInline={64}
        style={{ overflow: 'scroll', width: '100%' }}
      >
        <Settings
          config={agentConfig}
          id={groupId}
          loading={false}
          meta={agentMeta}
          tab={tab}
          onConfigChange={updateGroupConfig}
          onMetaChange={updateGroupMeta}
        />
      </Flexbox>
    </Flexbox>
  );
});

export default Content;

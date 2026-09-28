'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Avatar, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { PanelRightClose } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { TopicChatDrawerBody } from '@/features/AgentTasks/AgentTaskDetail/TopicChatDrawer';

import type { OriginTopicPanelProps } from './originConversation';

/**
 * The origin conversation rendered in the acceptance workspace's existing
 * right rail. It deliberately reuses the drawer's conversation body without
 * mounting the floating drawer chrome.
 */
const TopicPanel = memo<OriginTopicPanelProps>(
  ({ agentAvatar, agentBackgroundColor, agentId, onCollapse, title, topicId }) => {
    const { t } = useTranslation('verify');

    return (
      <Flexbox
        height={'100%'}
        style={{ background: cssVar.colorBgContainer, minHeight: 0, overflow: 'hidden' }}
      >
        <Flexbox
          horizontal
          align={'center'}
          gap={8}
          paddingBlock={12}
          paddingInline={12}
          style={{ borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}`, flexShrink: 0 }}
        >
          <Avatar
            avatar={agentAvatar ?? undefined}
            background={agentBackgroundColor ?? undefined}
            size={20}
          />
          <Text ellipsis strong style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
            {title}
          </Text>
          <ActionIcon
            icon={PanelRightClose}
            size={'small'}
            title={t('acceptance.ledger.collapse')}
            onClick={onCollapse}
          />
        </Flexbox>
        <Flexbox flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
          <TopicChatDrawerBody
            defaultInputExpanded
            disableInputCollapse
            agentId={agentId}
            topicId={topicId}
          />
        </Flexbox>
      </Flexbox>
    );
  },
);

TopicPanel.displayName = 'TopicPanel';

export default TopicPanel;

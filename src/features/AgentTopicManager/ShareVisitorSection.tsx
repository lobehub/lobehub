'use client';

import { CHANNEL_URL } from '@lobechat/const';
import type { ShareVisitorConversation } from '@lobechat/types';
import { formatPrice, formatTokenNumber } from '@lobechat/utils/format';
import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { CircleDollarSign, Zap } from 'lucide-react';
import { type KeyboardEvent, memo } from 'react';
import { useTranslation } from 'react-i18next';

import UserAvatar from '@/components/UserAvatar';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActivityTime } from '@/hooks/useActivityTime';

import { channelCardStyles as styles } from './ChannelSection';

/** Counts and amounts are compared across cards, so digits keep the same width. */
const NUMBER_STYLE = { fontVariantNumeric: 'tabular-nums' } as const;

const ShareVisitorCard = memo<{ conversation: ShareVisitorConversation }>(({ conversation }) => {
  const { t } = useTranslation('topic');
  const navigate = useWorkspaceAwareNavigate();
  const activity = useActivityTime(conversation.updatedAt ?? conversation.createdAt);
  const open = () => navigate(CHANNEL_URL(conversation.id));
  const name = conversation.visitor.name || t('management.shareVisitors.unnamedVisitor');
  const preview = conversation.lastMessage?.content?.trim();
  const { totalCost, totalTokens } = conversation;

  return (
    <Block
      className={stylex.props(styles.card).className}
      gap={8}
      role={'link'}
      tabIndex={0}
      variant={'outlined'}
      onClick={open}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === 'Enter') open();
      }}
    >
      <Flexbox horizontal align={'center'} gap={8}>
        <UserAvatar
          avatar={conversation.visitor.avatar}
          name={name}
          shape={'circle'}
          size={20}
          style={{ flex: 'none' }}
        />
        <Text ellipsis className={stylex.props(styles.title).className} fontSize={14} weight={600}>
          {name}
        </Text>
      </Flexbox>
      {preview && (
        <Text className={stylex.props(styles.preview).className} fontSize={12} type={'secondary'}>
          {preview}
        </Text>
      )}
      <Flexbox horizontal align={'center'} gap={12} {...stylex.props(styles.footer)}>
        <span title={activity.title}>{activity.text}</span>
        {totalTokens > 0 && (
          <Flexbox
            horizontal
            align={'center'}
            gap={3}
            style={NUMBER_STYLE}
            title={`${totalTokens} tokens`}
          >
            <Icon icon={Zap} size={11} />
            {formatTokenNumber(totalTokens)}
          </Flexbox>
        )}
        {totalCost > 0 && (
          <Flexbox
            horizontal
            align={'center'}
            gap={3}
            style={NUMBER_STYLE}
            title={`$${totalCost.toFixed(4)}`}
          >
            <Icon icon={CircleDollarSign} size={11} />
            {formatPrice(totalCost, 2)}
          </Flexbox>
        )}
      </Flexbox>
    </Block>
  );
});

ShareVisitorCard.displayName = 'AgentTopicManagerShareVisitorCard';

/**
 * Visitors' conversations with the Agent through its share link, one card per visitor. Each opens
 * the visitor's Channel read-only; its run topics stay private execution context.
 */
const ShareVisitorSection = memo<{ conversations: ShareVisitorConversation[] }>(
  ({ conversations }) => {
    const { t } = useTranslation('topic');
    if (conversations.length === 0) return null;

    return (
      <Flexbox gap={12}>
        <Flexbox gap={2}>
          <Text fontSize={13} type={'secondary'} weight={500}>
            {t('management.shareVisitors.title')}
          </Text>
          <Text fontSize={12} type={'secondary'}>
            {t('management.shareVisitors.desc')}
          </Text>
        </Flexbox>
        <div {...stylex.props(styles.grid)}>
          {conversations.map((conversation) => (
            <ShareVisitorCard conversation={conversation} key={conversation.id} />
          ))}
        </div>
      </Flexbox>
    );
  },
);

ShareVisitorSection.displayName = 'AgentTopicManagerShareVisitorSection';

export default ShareVisitorSection;

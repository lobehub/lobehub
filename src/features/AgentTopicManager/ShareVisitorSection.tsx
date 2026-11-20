'use client';

import { AGENT_SHARE_VISITOR_TOPIC_URL, CHANNEL_URL } from '@lobechat/const';
import type { ShareVisitorConversation } from '@lobechat/types';
import { formatPrice, formatTokenNumber } from '@lobechat/utils/format';
import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { CircleDollarSign, Zap } from 'lucide-react';
import { type KeyboardEvent, memo } from 'react';
import { useTranslation } from 'react-i18next';

import UserAvatar from '@/components/UserAvatar';
import { useShareVisitorTopics } from '@/features/ShareVisitorTopics/useShareVisitorTopics';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActivityTime } from '@/hooks/useActivityTime';

import { channelCardStyles as styles } from './ChannelSection';

/** Counts and amounts are compared across cards, so digits keep the same width. */
const NUMBER_STYLE = { fontVariantNumeric: 'tabular-nums' } as const;

interface ShareVisitorCardProps {
  agentId: string;
  conversation: ShareVisitorConversation;
  /** The visitor's newest run topic, where the full execution can be read. */
  latestTopicId?: string;
}

const ShareVisitorCard = memo<ShareVisitorCardProps>(({ agentId, conversation, latestTopicId }) => {
  const { t } = useTranslation('topic');
  const navigate = useWorkspaceAwareNavigate();
  const activity = useActivityTime(conversation.updatedAt ?? conversation.createdAt);
  // A conversation whose first run has not been claimed yet has no topic; its Channel shows it.
  const open = () =>
    navigate(
      latestTopicId
        ? AGENT_SHARE_VISITOR_TOPIC_URL(agentId, latestTopicId)
        : CHANNEL_URL(conversation.id),
    );
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
 * the visitor's newest run topic read-only, beside the visitor's other topics in the sidebar.
 */
const ShareVisitorSection = memo<{ agentId: string; conversations: ShareVisitorConversation[] }>(
  ({ agentId, conversations }) => {
    const { t } = useTranslation('topic');
    const topicGroups = useShareVisitorTopics(agentId);
    if (conversations.length === 0) return null;
    const latestTopicByVisitor = new Map(
      topicGroups.map((group) => [group.visitor.id, group.topics[0]?.id]),
    );

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
            <ShareVisitorCard
              agentId={agentId}
              conversation={conversation}
              key={conversation.id}
              latestTopicId={latestTopicByVisitor.get(conversation.visitor.id)}
            />
          ))}
        </div>
      </Flexbox>
    );
  },
);

ShareVisitorSection.displayName = 'AgentTopicManagerShareVisitorSection';

export default ShareVisitorSection;

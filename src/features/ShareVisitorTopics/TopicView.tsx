'use client';

import type { ConversationContext } from '@lobechat/types';
import { formatTokenNumber, formatUsd } from '@lobechat/utils/format';
import { Center, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { CoinsIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import ReadOnlyConversationSkeleton from '@/components/Skeleton/Conversation/ReadOnly';
import UserAvatar from '@/components/UserAvatar';
import { ChatList, ConversationProvider } from '@/features/Conversation';
import MessageItem from '@/features/Conversation/Messages';
import NavHeader from '@/features/NavHeader';

import { useShareVisitorTopic } from './useShareVisitorTopics';

/**
 * Counts and amounts are compared across topics, so digits keep the same width. Tokens and cost
 * read the way each reply's usage footer below shows them: a coins icon before the token count,
 * and a bare dollar amount (`formatUsd`) for the cost.
 */
const NUMBER_STYLE = { fontVariantNumeric: 'tabular-nums' } as const;

const renderMessage = (index: number, id: string) => (
  <MessageItem disableEditing id={id} index={index} key={id} />
);

/**
 * A visitor's run topic, opened read-only by the shared Agent's owner. The transcript is someone
 * else's conversation read through the share's grant: it is held, never synced, and renders the
 * way a shared topic does, with no composer and no message actions, so nothing the owner does here
 * writes into the visitor's context.
 */
const ShareVisitorTopicView = () => {
  const { t } = useTranslation('topic');
  const { aid, topicId } = useParams<{ aid: string; topicId: string }>();
  const { data, isLoading } = useShareVisitorTopic(topicId);
  const context = useMemo<ConversationContext>(
    () => ({
      agentId: aid ?? '',
      topicId: `share-visitor:${topicId}`,
      topicShareId: `share-visitor:${topicId}`,
    }),
    [aid, topicId],
  );

  if (isLoading && !data) return <ReadOnlyConversationSkeleton />;
  // Not found, or no longer readable: the share stopped allowing it, or the topic was deleted.
  if (!data) {
    return (
      <Center flex={1}>
        <Text type={'secondary'}>{t('shareVisitorTopics.unavailable')}</Text>
      </Center>
    );
  }

  const { messages, topic } = data;
  const name = topic.visitor.name || t('management.shareVisitors.unnamedVisitor');

  return (
    <Flexbox flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
      <NavHeader
        left={
          <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
            <UserAvatar
              avatar={topic.visitor.avatar}
              name={name}
              shape={'circle'}
              size={20}
              style={{ flex: 'none' }}
            />
            <Text ellipsis fontSize={14} weight={500}>
              {name}
            </Text>
            <Text ellipsis fontSize={14} type={'secondary'}>
              {topic.title || topic.preview || t('shareVisitorTopics.untitled')}
            </Text>
          </Flexbox>
        }
        right={
          <Flexbox horizontal align={'center'} gap={12} style={NUMBER_STYLE}>
            {topic.totalTokens > 0 && (
              <Flexbox horizontal align={'center'} gap={3} title={`${topic.totalTokens} tokens`}>
                <Icon icon={CoinsIcon} size={12} />
                <Text fontSize={12} type={'secondary'}>
                  {formatTokenNumber(topic.totalTokens)}
                </Text>
              </Flexbox>
            )}
            {topic.totalCost > 0 && (
              <Text fontSize={12} type={'secondary'}>
                {formatUsd(topic.totalCost)}
              </Text>
            )}
            <Tag title={t('shareVisitorTopics.readOnlyHint')}>
              {t('shareVisitorTopics.readOnly')}
            </Tag>
          </Flexbox>
        }
      />
      <ConversationProvider context={context} messages={messages}>
        <Flexbox flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
          <ChatList disableActionsBar itemContent={renderMessage} />
        </Flexbox>
      </ConversationProvider>
    </Flexbox>
  );
};

export default ShareVisitorTopicView;

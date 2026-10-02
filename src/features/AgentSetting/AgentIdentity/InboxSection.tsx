'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Skeleton, Text } from '@lobehub/ui/base-ui';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import InlineError from './InlineError';
import SectionHeader from './SectionHeader';
import { identityStyles } from './styles';
import { useAgentInbox } from './useAgentIdentity';
import { useInboxActions } from './useIdentityActions';

dayjs.extend(relativeTime);

interface InboxSectionProps {
  agentId: string;
}

/**
 * What has arrived at the agent's addresses.
 *
 * The list is the inbox: sender, subject and when it landed, newest first. A
 * row is the way in — opening one reads the stored message and clears its
 * unread mark, which is the only state the inbox keeps.
 */
const InboxSection = memo<InboxSectionProps>(({ agentId }) => {
  const { t } = useTranslation('setting');
  const { data, error, isLoading, mutate } = useAgentInbox(agentId);
  const { markAllRead, openMessage } = useInboxActions({ agentId, onChanged: mutate });

  const messages = data ?? [];
  const unreadCount = messages.filter((message) => !message.readAt).length;

  const extra =
    unreadCount > 0 ? (
      <Flexbox horizontal align={'center'} gap={12}>
        <Text fontSize={12} type={'secondary'}>
          {t('identity.inbox.unread', { count: unreadCount })}
        </Text>
        <Button size={'small'} type={'text'} onClick={() => void markAllRead()}>
          {t('identity.inbox.markAllRead')}
        </Button>
      </Flexbox>
    ) : undefined;

  const header = (
    <SectionHeader
      desc={t('identity.inbox.desc')}
      extra={extra}
      title={t('identity.inbox.title')}
    />
  );

  if (error) {
    return (
      <Flexbox gap={10}>
        {header}
        <InlineError
          detail={error instanceof Error ? error.message : String(error)}
          summary={t('identity.inbox.loadFailed')}
          onRetry={() => void mutate()}
        />
      </Flexbox>
    );
  }

  if (isLoading && !data) {
    return (
      <Flexbox gap={10}>
        {header}
        <Skeleton height={54} width={'100%'} />
        <Skeleton height={54} width={'100%'} />
      </Flexbox>
    );
  }

  if (messages.length === 0) {
    return (
      <Flexbox gap={10}>
        {header}
        <div className={identityStyles.empty}>{t('identity.inbox.empty')}</div>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={10}>
      {header}
      <Flexbox gap={8}>
        {messages.map((message) => {
          const unread = !message.readAt;

          return (
            <Flexbox
              horizontal
              align={'center'}
              className={identityStyles.inboxRow}
              gap={10}
              key={message.id}
              onClick={() => {
                void openMessage(message);
              }}
            >
              <span
                className={identityStyles.unreadDot}
                style={{ visibility: unread ? 'visible' : 'hidden' }}
              />
              <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
                  <Text ellipsis fontSize={13} weight={unread ? 500 : 400}>
                    {message.from}
                  </Text>
                  <Text fontSize={12} type={'secondary'}>
                    {dayjs(message.receivedAt).fromNow()}
                  </Text>
                </Flexbox>
                <Text ellipsis className={identityStyles.subject}>
                  {message.subject || t('identity.inbox.noSubject')}
                </Text>
              </Flexbox>
            </Flexbox>
          );
        })}
      </Flexbox>
    </Flexbox>
  );
});

InboxSection.displayName = 'AgentInboxSection';

export default InboxSection;

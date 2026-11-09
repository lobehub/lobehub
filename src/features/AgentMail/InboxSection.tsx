'use client';

import { Button, Flexbox, Skeleton, Text } from '@lobehub/ui';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import InlineError from './InlineError';
import SectionHeader from './SectionHeader';
import { identityStyles } from './styles';
import { useAgentInbox, useAgentInboxUnreadCount } from './useAgentIdentity';
import { useInboxActions } from './useIdentityActions';

dayjs.extend(relativeTime);

interface InboxSectionProps {
  /** The mailbox on screen; the list, the count and "mark all read" stay within it. */
  accountId?: string;
  agentId: string;
  onOpen: (id: string) => void;
  /** The message showing beside the list; its row stays highlighted. */
  selectedId?: string;
}

/**
 * What has arrived at the agent's addresses.
 *
 * The list is the inbox: sender, subject and when it landed, newest first. A
 * row is the way in — opening one reads the stored message and clears its
 * unread mark, which is the only state the inbox keeps.
 */
const InboxSection = memo<InboxSectionProps>(({ accountId, agentId, onOpen, selectedId }) => {
  const { t } = useTranslation('setting');
  const { data, error, hasMore, isLoading, loadMore, mutate } = useAgentInbox(agentId, accountId);
  const { data: unreadCount = 0, mutate: mutateUnread } = useAgentInboxUnreadCount(
    agentId,
    accountId,
  );
  const refresh = useCallback(
    () => Promise.all([mutate(), mutateUnread()]),
    [mutate, mutateUnread],
  );
  const { markAllRead, openMessage } = useInboxActions({
    accountId,
    agentId,
    onChanged: refresh,
    onOpen,
  });

  const messages = data ?? [];

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

  const header = <SectionHeader extra={extra} title={t('identity.inbox.title')} />;

  // A later fetch can fail while SWR still holds the last good result, and an
  // empty inbox is a legitimate result. Show the failure next to whatever is
  // cached instead of returning early, or an unreachable inbox reads as empty.
  const refreshError = error ? (
    <InlineError
      detail={error instanceof Error ? error.message : String(error)}
      summary={t('identity.inbox.loadFailed')}
      onRetry={() => void mutate()}
    />
  ) : undefined;

  // Only a first page that never loaded replaces the list. A failed refresh or
  // older page keeps every message already on screen, with a retry below it.
  if (error && !data) {
    return (
      <Flexbox gap={10}>
        {header}
        {refreshError}
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
        {refreshError}
      </Flexbox>
    );
  }

  return (
    <Flexbox flex={1} gap={10} style={{ minHeight: 0 }}>
      {header}
      {/* The list scrolls on its own so the header and addresses stay in view. */}
      <Flexbox flex={1} gap={2} style={{ minHeight: 0, overflowY: 'auto' }}>
        {messages.map((message) => {
          const unread = !message.readAt;
          const selected = message.id === selectedId;

          return (
            <Flexbox
              horizontal
              align={'flex-start'}
              aria-current={selected ? 'true' : undefined}
              aria-label={`${message.from} — ${message.subject || t('identity.inbox.noSubject')}`}
              className={selected ? identityStyles.inboxRowSelected : identityStyles.inboxRow}
              gap={10}
              key={message.id}
              role={'button'}
              style={{ flexShrink: 0 }}
              tabIndex={0}
              onClick={() => {
                void openMessage(message);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                void openMessage(message);
              }}
            >
              <span
                className={identityStyles.unreadDot}
                style={{ marginBlockStart: 7, visibility: unread ? 'visible' : 'hidden' }}
              />
              <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
                  <Text ellipsis fontSize={13} style={{ minWidth: 0 }} weight={unread ? 500 : 400}>
                    {message.from}
                  </Text>
                  <Text fontSize={12} style={{ flexShrink: 0 }} type={'secondary'}>
                    {dayjs(message.receivedAt).fromNow()}
                  </Text>
                </Flexbox>
                <Text ellipsis className={identityStyles.subject}>
                  {message.subject || t('identity.inbox.noSubject')}
                </Text>
                {message.preview && (
                  <Text ellipsis fontSize={12} type={'secondary'}>
                    {message.preview}
                  </Text>
                )}
              </Flexbox>
            </Flexbox>
          );
        })}
        {refreshError ??
          (hasMore && (
            <Button block size={'small'} style={{ flexShrink: 0 }} type={'text'} onClick={loadMore}>
              {t('identity.inbox.loadMore')}
            </Button>
          ))}
      </Flexbox>
    </Flexbox>
  );
});

InboxSection.displayName = 'AgentInboxSection';

export default InboxSection;

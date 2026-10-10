'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton, Text } from '@lobehub/ui/base-ui';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { agentAccountService } from '@/services/agentAccount';

import InlineError from './InlineError';

dayjs.extend(relativeTime);

export interface InboxMessageModalProps {
  id: string;
}

const MetaRow = memo<{ label: string; value: string }>(({ label, value }) => (
  <Flexbox horizontal gap={12}>
    <Text fontSize={12} style={{ flexShrink: 0, width: 68 }} type={'secondary'}>
      {label}
    </Text>
    <Text fontSize={13} style={{ wordBreak: 'break-all' }}>
      {value}
    </Text>
  </Flexbox>
));

MetaRow.displayName = 'InboxMessageMetaRow';

/**
 * One delivered message, fetched by id rather than taken from the list row.
 *
 * The list is a summary and may be stale; opening a message reads the stored
 * row, so the body shown is the body that was persisted.
 */
const InboxMessageModal = memo<InboxMessageModalProps>(({ id }) => {
  const { t } = useTranslation('setting');
  const { data, error, isLoading, mutate } = useSWR(['agent-inbox-message', id], ([, messageId]) =>
    agentAccountService.getInboxMessage(messageId),
  );

  // A failed read must say so: a skeleton that never resolves reads as "still
  // loading" forever.
  if (error && !data) {
    return (
      <Flexbox padding={4}>
        <InlineError
          detail={error instanceof Error ? error.message : String(error)}
          summary={t('identity.inbox.detail.loadFailed')}
          onRetry={() => void mutate()}
        />
      </Flexbox>
    );
  }

  if (isLoading || !data) {
    return (
      <Flexbox gap={12} padding={4}>
        <Skeleton height={20} width={'60%'} />
        <Skeleton height={14} width={'40%'} />
        <Skeleton height={120} width={'100%'} />
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={14} padding={4}>
      <Text fontSize={16} weight={600}>
        {data.subject || t('identity.inbox.noSubject')}
      </Text>
      <Flexbox gap={6}>
        <MetaRow label={t('identity.inbox.detail.from')} value={data.from} />
        <MetaRow label={t('identity.inbox.detail.to')} value={data.to} />
        <MetaRow
          label={t('identity.inbox.detail.receivedAt')}
          value={dayjs(data.receivedAt).format('YYYY-MM-DD HH:mm')}
        />
      </Flexbox>
      <Text
        fontSize={13}
        style={{ lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >
        {data.text}
      </Text>
      {data.attachments && data.attachments.length > 0 && (
        <Flexbox gap={6}>
          <Text fontSize={12} type={'secondary'}>
            {t('identity.inbox.detail.attachments')}
          </Text>
          {/* Links, not inline previews: the URLs come from an outside sender,
              and embedding them would let the sender see when mail is opened. */}
          {data.attachments.map((attachment, index) => (
            <a
              href={attachment.url}
              key={`${attachment.url}-${index}`}
              rel={'noopener noreferrer nofollow'}
              style={{ fontSize: 13, wordBreak: 'break-all' }}
              target={'_blank'}
            >
              {attachment.name || attachment.mimeType || attachment.url}
            </a>
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
});

InboxMessageModal.displayName = 'AgentInboxMessageModal';

export default InboxMessageModal;

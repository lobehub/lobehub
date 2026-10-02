'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton, Text } from '@lobehub/ui/base-ui';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { agentAccountService } from '@/services/agentAccount';

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
  const { data, isLoading } = useSWR(['agent-inbox-message', id], ([, messageId]) =>
    agentAccountService.getInboxMessage(messageId),
  );

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
    </Flexbox>
  );
});

InboxMessageModal.displayName = 'AgentInboxMessageModal';

export default InboxMessageModal;

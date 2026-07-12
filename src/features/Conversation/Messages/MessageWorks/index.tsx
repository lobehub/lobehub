'use client';

import type { WorkSummaryItem } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ClipboardListIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkSummaryCard from '@/features/AgentTasks/features/WorkSummaryCard';

import { dataSelectors, useConversationStore } from '../../store';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    width: 100%;
    margin-block-start: 8px;
  `,
  count: css`
    font-weight: 400;
    color: ${cssVar.colorTextQuaternary};
  `,
  header: css`
    padding-inline-start: 2px;
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface MessageWorksProps {
  rootOperationId?: string | null;
}

const MessageWorks = memo<MessageWorksProps>(({ rootOperationId }) => {
  const { t } = useTranslation('chat');
  // Works ride the message payload (attached server-side to each round's anchor
  // message), so the chip reads its summaries straight from the store index —
  // no dedicated work-summary fetch. The index is memoized per dbMessages
  // snapshot, so it's built once regardless of how many chips mount.
  const data: WorkSummaryItem[] = useConversationStore(
    dataSelectors.workSummariesByRootOperationId(rootOperationId),
    isEqual,
  );

  if (data.length === 0) return null;

  return (
    <Flexbox className={styles.container} gap={8}>
      <Flexbox horizontal align={'center'} className={styles.header} gap={6}>
        <ClipboardListIcon size={14} />
        <span>{t('workingPanel.works.title')}</span>
        {data.length > 1 && <span className={styles.count}>{data.length}</span>}
      </Flexbox>
      {data.map((item) => (
        <WorkSummaryCard item={item} key={item.id} />
      ))}
    </Flexbox>
  );
}, isEqual);

MessageWorks.displayName = 'MessageWorks';

export default MessageWorks;

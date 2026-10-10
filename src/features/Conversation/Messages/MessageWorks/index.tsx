'use client';

import type { WorkSummaryItem } from '@lobechat/types';
import { createStaticStyles, Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import WorkSummaryCard from '@/features/Work/WorkSummaryCard';

import { dataSelectors, useConversationStore } from '../../store';
import { useVisitorWorkOpen } from './useVisitorWorkOpen';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    width: 100%;
  `,
}));

interface MessageWorksProps {
  rootOperationId?: string | null;
}

const MessageWorks = memo<MessageWorksProps>(({ rootOperationId }) => {
  // Works ride the message payload (attached server-side to each round's anchor
  // message), so the chip reads its summaries straight from the store index —
  // no dedicated work-summary fetch. The index is memoized per dbMessages
  // snapshot, so it's built once regardless of how many chips mount.
  const data: WorkSummaryItem[] = useConversationStore(
    dataSelectors.workSummariesByRootOperationId(rootOperationId),
    isEqual,
  );

  const agentShareId = useConversationStore((s) => s.context.agentShareId);
  const handleVisitorOpen = useVisitorWorkOpen();

  if (data.length === 0) return null;

  return (
    <Flexbox className={styles.container} gap={8}>
      {data.map((item) => (
        <WorkSummaryCard
          item={item}
          key={item.id}
          onOpen={agentShareId ? handleVisitorOpen : undefined}
        />
      ))}
    </Flexbox>
  );
}, isEqual);

MessageWorks.displayName = 'MessageWorks';

export default MessageWorks;

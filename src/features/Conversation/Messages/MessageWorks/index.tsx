'use client';

import type { WorkSummaryItem } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import type { ComponentProps } from 'react';
import { memo } from 'react';

import WorkSummaryCard from '@/features/Work/WorkSummaryCard';

import { dataSelectors, useConversationStore } from '../../store';
import { useVisitorWorkOpen } from './useVisitorWorkOpen';

const styles = stylex.create({ container: { width: '100%' } });

interface MessageWorkListProps {
  items: WorkSummaryItem[];
  onOpen?: ComponentProps<typeof WorkSummaryCard>['onOpen'];
}

export const MessageWorkList = memo<MessageWorkListProps>(({ items, onOpen }) => {
  if (items.length === 0) return null;

  return (
    <Flexbox className={stylex.props(styles.container).className} gap={8}>
      {items.map((item) => (
        <WorkSummaryCard item={item} key={item.id} onOpen={onOpen} />
      ))}
    </Flexbox>
  );
});

MessageWorkList.displayName = 'MessageWorkList';

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

  return <MessageWorkList items={data} onOpen={agentShareId ? handleVisitorOpen : undefined} />;
}, isEqual);

MessageWorks.displayName = 'MessageWorks';

export default MessageWorks;

'use client';

import type { WorkSummaryItem } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useCallback } from 'react';

import { getWorkTypeDescriptor, isSafeExternalUrl } from '@/features/Work/descriptors';
import { createShareVisitorDocumentModal } from '@/features/Work/ShareVisitorDocumentModal';
import WorkSummaryCard from '@/features/Work/WorkSummaryCard';

import { dataSelectors, useConversationStore } from '../../store';

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

  // Agent-share visitor surface: the card's default open targets (Portal
  // document viewer, file preview, task detail) are all owner-scoped and the
  // page mounts no Portal, so route opens through share-authorized paths
  // instead. `/f/:id` is public by id, so file URLs open directly.
  const agentShareId = useConversationStore((s) => s.context.agentShareId);
  const topicId = useConversationStore((s) => s.context.topicId);
  const handleVisitorOpen = useCallback(
    (item: WorkSummaryItem) => {
      if (!agentShareId || !topicId) return;
      const descriptor = getWorkTypeDescriptor(item);
      const target = descriptor.getOpenTarget(item);
      if (!target) return;

      switch (target.kind) {
        case 'document': {
          createShareVisitorDocumentModal({
            documentId: target.documentId,
            shareId: agentShareId,
            title: descriptor.getTitle(item)?.trim() || descriptor.getIdentifier(item) || item.id,
            topicId,
          });
          return;
        }
        case 'external':
        case 'filePreview': {
          if (isSafeExternalUrl(target.url))
            window.open(target.url, '_blank', 'noopener,noreferrer');
          return;
        }
        default: {
          return;
        }
      }
    },
    [agentShareId, topicId],
  );

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

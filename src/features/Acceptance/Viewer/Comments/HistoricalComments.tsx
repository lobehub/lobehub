'use client';

import type { AcceptanceCommentThread } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { useOptionalAcceptanceScope } from '../AcceptanceScope';
import type { AcceptanceCheck, AcceptanceEvidence } from '../Checks/types';
import { EvidenceList } from '../Evidence/EvidenceList';
import type { EvidenceOverlayMap } from '../Evidence/overlay';
import { commentAnchorId, useCommentAnchor } from './anchor';
import CommentThread from './CommentThread';
import { historicalCommentEntries } from './historicalThreads';
import ThreadEvidence from './ThreadEvidence';

interface HistoricalCommentsProps extends Pick<
  ComponentProps<typeof CommentThread>,
  'canComment' | 'onDelete' | 'onReply' | 'onResolve'
> {
  canResolveThread: (thread: AcceptanceCommentThread) => boolean;
  evidenceById: Map<string, AcceptanceEvidence>;
  onRefreshEvidenceUrl?: (id: string) => Promise<string | undefined>;
  overlays?: EvidenceOverlayMap;
  threads: AcceptanceCommentThread[];
  timeline: AcceptanceCheck['timeline'];
}

/** Historical video discussions share the same player and index as current evidence. */
export const HistoricalComments = ({
  canComment,
  canResolveThread,
  evidenceById,
  onDelete,
  onRefreshEvidenceUrl,
  onReply,
  onResolve,
  overlays,
  threads,
  timeline,
}: HistoricalCommentsProps) => {
  const { t } = useTranslation('verify');
  const scope = useOptionalAcceptanceScope();
  useCommentAnchor(threads, scope?.embedded);
  return historicalCommentEntries(threads, evidenceById).map((entry) => {
    const { evidence } = entry;
    const roundIndex = timeline.find((round) =>
      round.evidence.some((item) => item.id === evidence?.id),
    )?.roundIndex;
    if (entry.type === 'video')
      return (
        <Flexbox gap={4} key={entry.evidence.id}>
          {roundIndex !== undefined && (
            <Text fontSize={12} type={'secondary'}>
              {t('acceptance.comments.evidenceFromRound', { round: roundIndex })}
            </Text>
          )}
          <EvidenceList
            evidence={[entry.evidence]}
            overlays={overlays}
            onRefreshEvidenceUrl={onRefreshEvidenceUrl}
          />
        </Flexbox>
      );
    const { thread } = entry;
    return (
      <Flexbox
        horizontal
        align={'flex-start'}
        gap={12}
        id={commentAnchorId(thread.root.id)}
        key={thread.root.id}
        wrap={'wrap'}
      >
        {evidence && (
          <ThreadEvidence stale comment={thread.root} evidence={evidence} roundIndex={roundIndex} />
        )}
        <Flexbox flex={1} style={{ minWidth: 200 }}>
          <CommentThread
            canComment={canComment}
            canResolve={canResolveThread(thread)}
            thread={thread}
            onDelete={onDelete}
            onReply={onReply}
            onResolve={onResolve}
          />
        </Flexbox>
      </Flexbox>
    );
  });
};

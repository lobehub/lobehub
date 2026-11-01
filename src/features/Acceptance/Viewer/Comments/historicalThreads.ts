import type { AcceptanceCommentThread } from '@lobechat/types';

import type { AcceptanceEvidence } from '../Checks/types';

export type HistoricalCommentEntry =
  | { evidence: AcceptanceEvidence; type: 'video' }
  | { evidence?: AcceptanceEvidence; thread: AcceptanceCommentThread; type: 'thread' };

/** Preserve comment order, sharing one player per original video. */
export const historicalCommentEntries = (
  threads: AcceptanceCommentThread[],
  evidenceById: Map<string, AcceptanceEvidence>,
): HistoricalCommentEntry[] => {
  const entries: HistoricalCommentEntry[] = [];
  const videos = new Set<string>();
  for (const thread of threads) {
    const evidence = evidenceById.get(thread.root.evidenceId ?? '');
    if (evidence?.type === 'video' && evidence.fileUrl && thread.root.time && thread.root.rect) {
      if (!videos.has(evidence.id)) {
        videos.add(evidence.id);
        entries.push({ evidence, type: 'video' });
      }
    } else entries.push({ evidence, thread, type: 'thread' });
  }
  return entries;
};

import { useCallback, useMemo, useState } from 'react';

import { type TopicListRevealState } from '@/features/AgentSidebar/Topic/TopicListScope';

/** Rows each "View all" click reveals beyond the shared `topicPageSize`. */
const REVEAL_STEP = 20;

/**
 * Rows the Project sidebar has revealed for `projectId`.
 *
 * The sidebar stays mounted under the persistent project layout, so the
 * expansion resets on every project change. Keying it by id alone would let a
 * return to project A (A → B → A) restore A's old expansion.
 */
export const useProjectTopicReveal = (projectId: string): TopicListRevealState => {
  const [revealed, setRevealed] = useState({ projectId, rows: 0 });
  // Adjust state while rendering on a prop change, so the reset lands before paint.
  if (revealed.projectId !== projectId) setRevealed({ projectId, rows: 0 });

  const extraRows = revealed.projectId === projectId ? revealed.rows : 0;
  const revealMore = useCallback(
    () => setRevealed({ projectId, rows: extraRows + REVEAL_STEP }),
    [projectId, extraRows],
  );

  return useMemo(() => ({ extraRows, revealMore }), [extraRows, revealMore]);
};

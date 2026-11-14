import type { MeetingActionItem } from '@lobechat/types';

/**
 * Passages closer than this are the same utterance. A refine pass re-runs the ASR over
 * the same audio, so a passage keeps its offset to within a second or two even when the
 * whole transcript is re-segmented.
 */
export const SAME_PASSAGE_MS = 2000;

export interface MergedActionItems {
  /** Only the suggestions that survived the merge, i.e. the ones that may create tasks. */
  fresh: MeetingActionItem[];
  /** What gets written back: the surviving items, then the new suggestions. */
  items: MeetingActionItem[];
}

/**
 * Fold a freshly generated item list into the stored one, under the minutes write lock.
 *
 * Items already turned into tasks are kept untouched, so their task links never break.
 * A suggestion that cites the same passage as one of them is the same to-do and is
 * dropped: identity is the passage offset (`startMs`), because a refine pass replaces
 * the segments a kept item cites — the ids change, the audio behind them does not.
 */
export const mergeActionItems = (
  stored: MeetingActionItem[],
  generated: MeetingActionItem[],
): MergedActionItems => {
  const kept = stored.filter((item) => item.status === 'created');

  const takenSegments = new Set(kept.flatMap((item) => item.segmentIds));
  const takenOffsets = kept
    .map((item) => item.startMs)
    .filter((startMs): startMs is number => typeof startMs === 'number');

  const fresh = generated.filter((item) => {
    if (item.segmentIds.some((id) => takenSegments.has(id))) return false;

    const { startMs } = item;
    if (typeof startMs !== 'number') return true;

    return !takenOffsets.some((taken) => Math.abs(taken - startMs) <= SAME_PASSAGE_MS);
  });

  return { fresh, items: [...kept, ...fresh] };
};

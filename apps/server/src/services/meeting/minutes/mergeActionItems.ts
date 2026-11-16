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

/** Everything that is not a letter or a digit, so `Ship it!` and `ship  it` compare equal. */
const ACTION_TEXT_NOISE = /[^\p{L}\p{N}]+/gu;

/**
 * The content of a to-do with case, punctuation and spacing taken out. A refine pass may
 * re-word the same commitment in trivial ways; two different commitments never normalize
 * to the same string.
 */
export const normalizeActionText = (text: string) =>
  text.normalize('NFKC').toLowerCase().replace(ACTION_TEXT_NOISE, ' ').trim();

/** Whether two items come from the same utterance, whether or not their ids line up. */
const citesSamePassage = (kept: MeetingActionItem, item: MeetingActionItem) => {
  if (item.segmentIds.some((id) => kept.segmentIds.includes(id))) return true;

  if (typeof kept.startMs !== 'number' || typeof item.startMs !== 'number') return false;

  return Math.abs(kept.startMs - item.startMs) <= SAME_PASSAGE_MS;
};

/**
 * Fold a freshly generated item list into the stored one, under the minutes write lock.
 *
 * Items already turned into tasks are kept untouched, so their task links never break.
 * A suggestion is dropped only when it is the same to-do as one of them: it cites the
 * same passage *and* it says the same thing. The passage alone is not identity — an ASR
 * model without timestamped output stores the whole chunk as a single segment, so several
 * unrelated commitments share it, and regenerating the minutes must not delete the ones
 * that never became a task.
 */
export const mergeActionItems = (
  stored: MeetingActionItem[],
  generated: MeetingActionItem[],
): MergedActionItems => {
  const kept = stored.filter((item) => item.status === 'created');
  const keptTexts = kept.map((item) => normalizeActionText(item.text));

  const fresh = generated.filter((item) => {
    const text = normalizeActionText(item.text);

    return !kept.some(
      (keptItem, index) => keptTexts[index] === text && citesSamePassage(keptItem, item),
    );
  });

  return { fresh, items: [...kept, ...fresh] };
};

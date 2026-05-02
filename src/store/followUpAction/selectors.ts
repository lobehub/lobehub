import type { FollowUpChip } from '@lobechat/types';

import { type FollowUpActionState } from './initialState';

const EMPTY_CHIPS: readonly FollowUpChip[] = [];

interface ChipsForArgs {
  /**
   * Pipe-joined ids of the displayMessage's children blocks (for assistantGroup).
   * Server-side resolves the latest answer message id, which inside an
   * assistantGroup is a child block id rather than the group id, so we accept
   * any child id as a valid match in addition to the top-level id.
   */
  childIdsKey?: string;
  messageId: string | undefined;
  topicId: string | undefined;
}

/**
 * Chips render only when ALL hold:
 * - status === 'ready'
 * - the stored topicId matches
 * - the stored messageId matches the bound message id OR one of its child block ids
 *
 * Topic-only matching would let stale chips from a previous turn render under
 * a newly streaming assistant message in the same topic, so messageId membership
 * is required.
 */
const chipsFor =
  ({ childIdsKey, messageId, topicId }: ChipsForArgs) =>
  (s: FollowUpActionState): readonly FollowUpChip[] => {
    if (s.status !== 'ready') return EMPTY_CHIPS;
    if (!messageId || !topicId) return EMPTY_CHIPS;
    if (s.topicId !== topicId) return EMPTY_CHIPS;
    if (!s.messageId) return EMPTY_CHIPS;
    if (s.messageId === messageId) return s.chips;
    if (childIdsKey && childIdsKey.split('|').includes(s.messageId)) return s.chips;
    return EMPTY_CHIPS;
  };

export const followUpActionSelectors = {
  chipsFor,
};

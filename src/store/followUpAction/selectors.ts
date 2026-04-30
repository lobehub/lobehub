import type { FollowUpChip } from '@lobechat/types';

import { type FollowUpActionState } from './initialState';

const EMPTY_CHIPS: readonly FollowUpChip[] = [];

const chipsForMessage =
  (messageId: string) =>
  (s: FollowUpActionState): readonly FollowUpChip[] =>
    s.messageId === messageId && s.status === 'ready' ? s.chips : EMPTY_CHIPS;

const isReady = (messageId: string) => (s: FollowUpActionState) =>
  s.messageId === messageId && s.status === 'ready' && s.chips.length > 0;

export const followUpActionSelectors = {
  chipsForMessage,
  isReady,
};

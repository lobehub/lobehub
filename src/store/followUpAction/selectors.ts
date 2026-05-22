import type { FollowUpChip } from '@lobechat/types';

import { type FollowUpActionState, type FollowUpActionStatus } from './initialState';

const EMPTY_CHIPS: readonly FollowUpChip[] = [];

interface ChipsForArgs {
  /** Pipe-joined ids of the assistantGroup's child blocks — the server resolves the latest answer to a child block id, not the group id. */
  childIdsKey?: string;
  conversationKey: string | undefined;
  messageId: string | undefined;
}

const chipsFor =
  ({ childIdsKey, conversationKey, messageId }: ChipsForArgs) =>
  (s: FollowUpActionState): readonly FollowUpChip[] => {
    if (!conversationKey || !messageId) return EMPTY_CHIPS;
    const slot = s.slots[conversationKey];
    if (!slot || slot.status !== 'ready' || !slot.messageId) return EMPTY_CHIPS;
    if (slot.messageId === messageId) return slot.chips;
    if (childIdsKey && childIdsKey.split('|').includes(slot.messageId)) return slot.chips;
    return EMPTY_CHIPS;
  };

const slotStatus =
  (conversationKey: string | undefined) =>
  (s: FollowUpActionState): FollowUpActionStatus =>
    (conversationKey ? s.slots[conversationKey]?.status : undefined) ?? 'idle';

export const followUpActionSelectors = {
  chipsFor,
  slotStatus,
};

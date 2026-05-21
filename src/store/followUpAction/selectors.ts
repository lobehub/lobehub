import type { FollowUpChip } from '@lobechat/types';

import {
  type FollowUpActionSlot,
  type FollowUpActionState,
  type FollowUpActionStatus,
} from './initialState';

const EMPTY_CHIPS: readonly FollowUpChip[] = [];

interface ChipsForArgs {
  /**
   * Pipe-joined ids of the displayMessage's children blocks (for assistantGroup).
   * Server-side resolves the latest answer message id, which inside an
   * assistantGroup is a child block id rather than the group id, so we accept
   * any child id as a valid match in addition to the top-level id.
   */
  childIdsKey?: string;
  conversationKey: string | undefined;
  messageId: string | undefined;
}

/**
 * Chips render only when ALL hold:
 * - the slot for `conversationKey` exists and is `ready`
 * - the slot's `messageId` matches the bound id OR one of its child block ids
 */
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
    (conversationKey && s.slots[conversationKey]?.status) || 'idle';

const slotFor =
  (conversationKey: string | undefined) =>
  (s: FollowUpActionState): FollowUpActionSlot | undefined =>
    conversationKey ? s.slots[conversationKey] : undefined;

export const followUpActionSelectors = {
  chipsFor,
  slotFor,
  slotStatus,
};

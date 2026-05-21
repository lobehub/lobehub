import type { FollowUpChip } from '@lobechat/types';

export type FollowUpActionStatus = 'idle' | 'loading' | 'ready';

/**
 * Per-conversation slot. One slot per `conversationKey` lets concurrent surfaces
 * (inbox, popup, portal thread) drive their own follow-up extractions without
 * aborting each other.
 */
export interface FollowUpActionSlot {
  abortController?: AbortController;
  chips: FollowUpChip[];
  messageId?: string;
  pendingMessageId?: string;
  status: FollowUpActionStatus;
}

export interface FollowUpActionState {
  slots: Record<string, FollowUpActionSlot>;
}

export const initialFollowUpActionState: FollowUpActionState = {
  slots: {},
};

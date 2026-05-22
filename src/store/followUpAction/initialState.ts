import type { FollowUpChip } from '@lobechat/types';

export type FollowUpActionStatus = 'idle' | 'loading' | 'ready';

/** Per-conversation slot — concurrent surfaces (inbox, popup, thread) own their own slot. */
export interface FollowUpActionSlot {
  abortController?: AbortController;
  chips: FollowUpChip[];
  messageId?: string;
  status: FollowUpActionStatus;
}

export interface FollowUpActionState {
  slots: Record<string, FollowUpActionSlot>;
}

export const initialFollowUpActionState: FollowUpActionState = {
  slots: {},
};

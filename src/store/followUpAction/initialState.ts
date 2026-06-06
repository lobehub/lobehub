import type { FollowUpChip } from '@lobechat/types';

export type FollowUpActionStatus = 'idle' | 'loading' | 'ready';

/** Per-conversation slot — concurrent surfaces (inbox, popup, thread) own their own slot. */
export interface FollowUpActionSlot {
  abortController?: AbortController;
  chips: FollowUpChip[];
  /** Guards against double-reporting feedback (a click followed by the clear-on-send). */
  feedbackDone?: boolean;
  messageId?: string;
  status: FollowUpActionStatus;
  /** `llm_generation_tracing` row id this chip set was generated under, if any. */
  tracingId?: string;
}

export interface FollowUpActionState {
  slots: Record<string, FollowUpActionSlot>;
}

export const initialFollowUpActionState: FollowUpActionState = {
  slots: {},
};

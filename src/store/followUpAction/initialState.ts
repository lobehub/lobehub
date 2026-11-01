import type { FollowUpChip } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

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
  /** The replica view: one slot per conversation key. */
  slots: Record<string, FollowUpActionSlot>;
  /** Replica bookkeeping for `slots` (see `followUpSlotResource`). */
  slotsReplica: ReplicaState<FollowUpActionSlot>;
}

export const initialFollowUpActionState: FollowUpActionState = {
  slots: {},
  slotsReplica: createReplicaState(),
};

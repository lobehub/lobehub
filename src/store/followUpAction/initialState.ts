import type { FollowUpChip } from '@lobechat/types';

export type FollowUpActionStatus = 'idle' | 'loading' | 'ready';

export interface FollowUpActionState {
  abortController?: AbortController;
  chips: FollowUpChip[];
  messageId?: string;
  pendingTopicId?: string;
  status: FollowUpActionStatus;
  topicId?: string;
}

export const initialFollowUpActionState: FollowUpActionState = {
  chips: [],
  status: 'idle',
};

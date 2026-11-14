import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type { EvalConversationTopic } from './projection';

export interface ConversationSliceState {
  /** Picker results, keyed by `conversationPickerKey`. */
  conversationTopicMap: Record<string, EvalConversationTopic[]>;
  conversationTopicReplica: ReplicaState<EvalConversationTopic[]>;
}

export const conversationInitialState: ConversationSliceState = {
  conversationTopicMap: {},
  conversationTopicReplica: createReplicaState(),
};

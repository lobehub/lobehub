import { type KnowledgeItem } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

export interface KnowledgeSliceState {
  /** Local-first bookkeeping for `agentKnowledgeMap`. */
  agentKnowledgeListReplica: ReplicaState<KnowledgeItem[]>;
  /** Files + knowledge bases per visibility surface (`agentKnowledgeMap[<agentId>[:<visibility>]]`). */
  agentKnowledgeMap: Record<string, KnowledgeItem[]>;
}

export const initialKnowledgeSliceState: KnowledgeSliceState = {
  agentKnowledgeMap: {},
  agentKnowledgeListReplica: createReplicaState(),
};

import type { OpenedSubTopic } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

export interface ChatSubTopicState {
  /**
   * Sub-topics by sidebar page (`subTopicTreeKey`), written only through
   * the replica. An `undefined` entry means that page is not loaded yet.
   */
  subTopicTreeMap: Record<string, OpenedSubTopic[]>;
  subTopicTreeReplica: ReplicaState<OpenedSubTopic[]>;
}

export const initialSubTopicState: ChatSubTopicState = {
  subTopicTreeMap: {},
  subTopicTreeReplica: createReplicaState<OpenedSubTopic[]>(),
};

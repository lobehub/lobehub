import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type { OpenedSubSession } from '@/services/subSession';

export interface ChatSubSessionState {
  /**
   * Sub-sessions by sidebar page (`subSessionTreeKey`), written only through
   * the replica. An `undefined` entry means that page is not loaded yet.
   */
  subSessionTreeMap: Record<string, OpenedSubSession[]>;
  subSessionTreeReplica: ReplicaState<OpenedSubSession[]>;
}

export const initialSubSessionState: ChatSubSessionState = {
  subSessionTreeMap: {},
  subSessionTreeReplica: createReplicaState<OpenedSubSession[]>(),
};

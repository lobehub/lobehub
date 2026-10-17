import { type NotebookDocument } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

export interface NotebookState {
  /** Replica bookkeeping for `notebookMap`. */
  notebookDocumentsReplica: ReplicaState<NotebookDocument[]>;
  /**
   * Map of topicId -> notebook documents list.
   *
   * This is the view of `notebookDocumentsResource`; it is written only by the
   * replica slice in `action.ts` and read through `notebookSelectors`.
   */
  notebookMap: Record<string, NotebookDocument[]>;
}

export const initialNotebookState: NotebookState = {
  notebookMap: {},
  notebookDocumentsReplica: createReplicaState(),
};

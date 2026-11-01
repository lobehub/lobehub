import { createReplicaState, type ReplicaState } from '@/libs/replica';

import { type FileDocumentDetail } from './projection';

export interface DocumentState {
  /**
   * The file store's document rows, keyed by document id — the replica view.
   * Selectors read this location; the replica slice is its only writer.
   */
  documentMap: Record<string, FileDocumentDetail>;
  /**
   * Replica bookkeeping of `documentMap` (hydration, optimistic overlays,
   * scope and persistence state).
   */
  fileDocumentReplica: ReplicaState<FileDocumentDetail>;
}

export const initialDocumentState: DocumentState = {
  documentMap: {},
  fileDocumentReplica: createReplicaState(),
};

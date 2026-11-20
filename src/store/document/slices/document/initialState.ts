import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type { DocumentDetail } from './projection';

export interface DocumentDetailSliceState {
  /** Server rows of the documents opened this session, keyed by document id. */
  documentDetailMap: Record<string, DocumentDetail>;
  /** Replica bookkeeping of `documentDetailMap` (its view). */
  documentDetailReplica: ReplicaState<DocumentDetail>;
}

export const initialDocumentDetailSliceState: DocumentDetailSliceState = {
  documentDetailMap: {},
  documentDetailReplica: createReplicaState(),
};

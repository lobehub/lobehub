import { createReplicaState, type ReplicaState } from '@/libs/replica';

import type { LibraryTreeSnapshot } from './projection';
import type { TreeDataState } from './types';

export interface TreeInitialState extends TreeDataState {
  epoch: number;
  errors: Record<string, unknown>;
  expanded: Record<string, boolean>;
  knowledgeBaseId: string | null;
  /** Last confirmed tree per library, as persisted (see `libraryTreeResource`). */
  snapshotMap: Record<string, LibraryTreeSnapshot>;
  snapshotReplica: ReplicaState<LibraryTreeSnapshot>;
}

export const initialTreeState: TreeInitialState = {
  children: {},
  epoch: 0,
  errors: {},
  expanded: {},
  knowledgeBaseId: null,
  snapshotMap: {},
  snapshotReplica: createReplicaState(),
  status: {},
};

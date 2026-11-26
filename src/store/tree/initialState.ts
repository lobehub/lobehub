import { createReplicaState, type ReplicaState } from '@/libs/replica';
import { SortType } from '@/types/files';
import type { ResourceSorter } from '@/types/resource';

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
  sorter: ResourceSorter;
  sortType: SortType;
}

export const initialTreeState: TreeInitialState = {
  sorter: 'custom',
  sortType: SortType.Asc,
  children: {},
  epoch: 0,
  errors: {},
  expanded: {},
  knowledgeBaseId: null,
  snapshotMap: {},
  snapshotReplica: createReplicaState(),
  status: {},
};

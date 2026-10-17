import { createReplicaState, type ReplicaState } from '@/libs/replica';
import { type ResourceItem } from '@/types/resource';

import { type ResourceListParams, type ResourceListValue } from './projection';

/**
 * Resource slice state.
 *
 * The list itself is a `@lobechat/replica` paged resource: `resourceListEntry`
 * is the replica view, and `resourceList` / `resourceMap` / `hasMore` / `total`
 * / `offset` / `queryParams` / `isLoadingMore` are derived from it by the
 * slice's lens, so every existing selector keeps reading the same place.
 */
export interface ResourceState {
  /** Pagination state (derived from the replica view). */
  hasMore: boolean;

  /** Loading states */
  isLoadingMore: boolean;

  /** Number of rows currently painted (derived from the replica view). */
  offset: number;
  /** Current query parameters (the query the painted page set answers). */
  queryParams?: ResourceListParams;
  /**
   * Derived sorted/filtered list (computed from the replica view)
   * Used for rendering in UI
   */
  resourceList: ResourceItem[];

  /**
   * The replica view of the explorer list — what the engine reads and writes.
   * `undefined` until the persisted row hydrates or the first network page
   * lands, so an un-loaded list never reads as an empty one.
   */
  resourceListEntry?: ResourceListValue;

  /** Replica bookkeeping of `resourceListEntry`. */
  resourceListReplica: ReplicaState<ResourceListValue>;

  /**
   * Primary store - Map for O(1) lookups (derived from the replica view)
   */
  resourceMap: Map<string, ResourceItem>;

  total: number;
}

/**
 * Initial state for resource slice
 */
export const initialResourceState: ResourceState = {
  hasMore: false,
  isLoadingMore: false,
  offset: 0,
  queryParams: undefined,
  resourceList: [],
  resourceListEntry: undefined,
  resourceListReplica: createReplicaState(),
  resourceMap: new Map(),
  total: 0,
};

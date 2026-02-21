import { type ResourceItem, type ResourceQueryParams, type SyncOperation } from '@/types/resource';

/**
 * Resource slice state
 */
export interface ResourceState {
  /**
   * Pagination state
   */
  hasMore: boolean;

  /**
   * Loading states
   */
  isLoadingMore: boolean;

  isSyncing: boolean;

  /**
   * Sync status
   */
  lastSyncTime?: Date;

  offset: number;
  /**
   * Current query parameters
   */
  queryParams?: ResourceQueryParams;
  /**
   * Derived sorted/filtered list (computed from map)
   * Used for rendering in UI
   */
  resourceList: ResourceItem[];

  /**
   * Primary store - Map for O(1) lookups
   */
  resourceMap: Map<string, ResourceItem>;

  syncError?: Error;
  /**
   * Track which resources are currently syncing
   */
  syncingIds: Set<string>;

  /**
   * Sync queue (FIFO)
   * Contains pending operations to be synced to server
   */
  syncQueue: SyncOperation[];
  total: number;
}

/**
 * Initial state for resource slice
 */
export const initialResourceState: ResourceState = {
  hasMore: false,
  isLoadingMore: false,
  isSyncing: false,
  offset: 0,
  resourceList: [],
  resourceMap: new Map(),
  syncQueue: [],
  syncingIds: new Set(),
  total: 0,
};

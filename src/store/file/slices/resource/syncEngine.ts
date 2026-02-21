import { debounce } from 'es-toolkit';
import { type DebouncedFunc } from 'es-toolkit/compat';
import pMap from 'p-map';

import { resourceService } from '@/services/resource';
import { type ResourceItem, type SyncOperation } from '@/types/resource';

/**
 * Sync configuration
 */
const SYNC_CONFIG = {
  BACKOFF_MULTIPLIER: 2,
  BATCH_SIZE: 10,
  CONCURRENCY: 3,
  DEBOUNCE_MS: 300, // Wait after last operation
  MAX_RETRIES: 3,
  MAX_WAIT_MS: 2000, // Force sync after 2s
  RETRY_DELAY_MS: 1000,
} as const;

/**
 * State getter/setter interface
 */
interface StateManager {
  getState: () => {
    resourceList: ResourceItem[];
    resourceMap: Map<string, ResourceItem>;
    syncQueue: SyncOperation[];
    syncingIds: Set<string>;
  };
  setState: (partial: {
    resourceList?: ResourceItem[];
    resourceMap?: Map<string, ResourceItem>;
    syncQueue?: SyncOperation[];
    syncingIds?: Set<string>;
  }) => void;
}

/**
 * ResourceSyncEngine - Background sync engine for resource operations
 *
 * Features:
 * - Debounced sync (300ms, max 2s)
 * - Batch processing (10 operations per batch)
 * - Concurrency control (3 parallel requests)
 * - Retry logic with exponential backoff (3 attempts)
 * - Error state marking (no rollback)
 */
export class ResourceSyncEngine {
  private debouncedSync: DebouncedFunc<() => Promise<void>>;
  private stateManager: StateManager;

  constructor(getState: StateManager['getState'], setState: StateManager['setState']) {
    this.stateManager = { getState, setState };

    this.debouncedSync = debounce(() => this.processQueue(), SYNC_CONFIG.DEBOUNCE_MS, {
      edges: ['trailing'],
    }) as DebouncedFunc<() => Promise<void>>;

    // Add maxWait behavior manually since es-toolkit debounce doesn't support it
    let lastExecution = 0;
    const originalSync = this.debouncedSync;

    this.debouncedSync = (() => {
      const now = Date.now();
      if (now - lastExecution >= SYNC_CONFIG.MAX_WAIT_MS) {
        lastExecution = now;
        originalSync.flush?.();
        return originalSync();
      } else {
        return originalSync();
      }
    }) as unknown as DebouncedFunc<() => Promise<void>>;

    this.debouncedSync.flush = originalSync.flush;
    this.debouncedSync.cancel = originalSync.cancel;
  }

  /**
   * Enqueue a sync operation and return a Promise that resolves when it completes
   * For 'create' operations, resolves with the real resource ID
   * For other operations, resolves with void
   */
  enqueue(operation: Omit<SyncOperation, 'resolve' | 'reject'>): Promise<any> {
    return new Promise((resolve, reject) => {
      const { syncQueue } = this.stateManager.getState();
      const operationWithPromise: SyncOperation = {
        ...operation,
        reject,
        resolve,
      };

      this.stateManager.setState({
        syncQueue: [...syncQueue, operationWithPromise],
      });

      // Trigger debounced sync
      this.debouncedSync();
    });
  }

  /**
   * Flush pending operations immediately
   */
  async flush(): Promise<void> {
    this.debouncedSync.flush?.();
    await this.processQueue();
  }

  /**
   * Process the sync queue
   */
  private async processQueue(): Promise<void> {
    const { syncQueue } = this.stateManager.getState();

    if (syncQueue.length === 0) return;

    // Take batch from queue
    const batch = syncQueue.slice(0, SYNC_CONFIG.BATCH_SIZE);
    const remaining = syncQueue.slice(SYNC_CONFIG.BATCH_SIZE);

    // Update queue (remove batch)
    this.stateManager.setState({ syncQueue: remaining });

    // Process batch with concurrency limit
    await pMap(
      batch,
      async (operation) => {
        try {
          await this.processOperation(operation);
        } catch (error) {
          await this.handleOperationError(operation, error as Error);
        }
      },
      { concurrency: SYNC_CONFIG.CONCURRENCY },
    );

    // Continue processing if there are more operations
    if (remaining.length > 0) {
      await this.processQueue();
    }
  }

  /**
   * Process a single sync operation
   */
  private async processOperation(operation: SyncOperation): Promise<void> {
    const { resourceId, type, payload } = operation;

    // Mark as syncing
    const { syncingIds } = this.stateManager.getState();
    syncingIds.add(resourceId);
    this.stateManager.setState({ syncingIds: new Set(syncingIds) });

    try {
      let realId: string | undefined;

      switch (type) {
        case 'create': {
          const created = await resourceService.createResource(payload);
          this.replaceTempResource(resourceId, created);
          realId = created.id;
          break;
        }

        case 'update': {
          const updated = await resourceService.updateResource(resourceId, payload);
          this.updateResourceInStore(updated);
          break;
        }

        case 'delete': {
          await resourceService.deleteResource(resourceId);
          // Resource already removed from store optimistically
          break;
        }

        case 'move': {
          await resourceService.moveResource(resourceId, payload.parentId);
          // Don't update store - resource has already been removed optimistically
          // and should stay removed since it moved to a different location
          break;
        }
      }

      // Clear optimistic state on success
      this.clearOptimisticState(resourceId);

      // Resolve promise for this operation (return real ID for create)
      operation.resolve?.(realId);
    } finally {
      // Unmark as syncing
      const { syncingIds: currentSyncingIds } = this.stateManager.getState();
      currentSyncingIds.delete(resourceId);
      this.stateManager.setState({ syncingIds: new Set(currentSyncingIds) });
    }
  }

  /**
   * Handle operation error
   */
  private async handleOperationError(operation: SyncOperation, error: Error): Promise<void> {
    const { resourceId, retryCount } = operation;

    if (retryCount < SYNC_CONFIG.MAX_RETRIES) {
      // Retry: increment count and re-queue with delay
      const delay = SYNC_CONFIG.RETRY_DELAY_MS * SYNC_CONFIG.BACKOFF_MULTIPLIER ** retryCount;

      setTimeout(() => {
        const { syncQueue } = this.stateManager.getState();
        this.stateManager.setState({
          syncQueue: [
            ...syncQueue,
            {
              ...operation,
              retryCount: retryCount + 1,
            },
          ],
        });
        this.debouncedSync();
      }, delay);
    } else {
      // Max retries reached: mark resource with error state and reject promise
      this.markResourceError(resourceId, error);
      operation.reject?.(error);
    }
  }

  /**
   * Replace temp resource with real resource from server
   */
  private replaceTempResource(tempId: string, realResource: ResourceItem): void {
    const { resourceMap, resourceList } = this.stateManager.getState();

    // Remove temp from map, add real
    resourceMap.delete(tempId);
    resourceMap.set(realResource.id, realResource);

    // Replace in list
    const listIndex = resourceList.findIndex((r) => r.id === tempId);
    if (listIndex >= 0) {
      resourceList[listIndex] = realResource;
    }

    this.stateManager.setState({
      resourceList: [...resourceList],
      resourceMap: new Map(resourceMap),
    });
  }

  /**
   * Update resource in store with fresh data from server
   */
  private updateResourceInStore(resource: ResourceItem): void {
    const { resourceMap, resourceList } = this.stateManager.getState();

    resourceMap.set(resource.id, resource);

    const listIndex = resourceList.findIndex((r) => r.id === resource.id);
    if (listIndex >= 0) {
      resourceList[listIndex] = resource;
    }

    this.stateManager.setState({
      resourceList: [...resourceList],
      resourceMap: new Map(resourceMap),
    });
  }

  /**
   * Clear optimistic state from resource
   */
  private clearOptimisticState(resourceId: string): void {
    const { resourceMap, resourceList } = this.stateManager.getState();
    const resource = resourceMap.get(resourceId);

    if (resource?._optimistic) {
      const updated = { ...resource };
      delete updated._optimistic;

      resourceMap.set(resourceId, updated);

      const listIndex = resourceList.findIndex((r) => r.id === resourceId);
      if (listIndex >= 0) {
        resourceList[listIndex] = updated;
      }

      this.stateManager.setState({
        resourceList: [...resourceList],
        resourceMap: new Map(resourceMap),
      });
    }
  }

  /**
   * Mark resource with error state
   */
  private markResourceError(resourceId: string, error: Error): void {
    const { resourceMap, resourceList } = this.stateManager.getState();
    const resource = resourceMap.get(resourceId);

    if (resource) {
      const updated = {
        ...resource,
        _optimistic: {
          error,
          isPending: false,
          lastSyncAttempt: new Date(),
          retryCount: SYNC_CONFIG.MAX_RETRIES,
        },
      };

      resourceMap.set(resourceId, updated);

      const listIndex = resourceList.findIndex((r) => r.id === resourceId);
      if (listIndex >= 0) {
        resourceList[listIndex] = updated;
      }

      this.stateManager.setState({
        resourceList: [...resourceList],
        resourceMap: new Map(resourceMap),
      });
    }
  }
}

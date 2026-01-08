import debug from 'debug';
import type { StateCreator } from 'zustand/vanilla';

import { resourceService } from '@/services/resource';
import type { CreateResourceParams, ResourceItem, UpdateResourceParams } from '@/types/resource';

import type { FileStore } from '../../store';
import { type ResourceState, initialResourceState } from './initialState';
import { ResourceSyncEngine } from './syncEngine';

const log = debug('resource-manager:action');

/**
 * Resource slice actions
 */
export interface ResourceAction {
  /**
   * Clear all resources and reset state
   */
  clearResources: () => void;

  /**
   * Create a new resource with optimistic update
   * Returns temp ID for immediate UI feedback
   */
  createResource: (params: CreateResourceParams) => Promise<string>;

  /**
   * Create a new resource and wait for sync to complete
   * Returns real ID from server (useful for auto-rename after creation)
   */
  createResourceAndSync: (params: CreateResourceParams) => Promise<string>;

  /**
   * Delete a resource with optimistic update
   */
  deleteResource: (id: string) => Promise<void>;

  /**
   * Flush pending sync operations immediately
   */
  flushSync: () => Promise<void>;

  /**
   * Load more resources (pagination)
   */
  loadMoreResources: () => Promise<void>;

  /**
   * Move a resource to a different parent folder
   */
  moveResource: (id: string, parentId: string | null) => Promise<void>;

  /**
   * Retry a failed sync operation
   */
  retrySync: (resourceId: string) => Promise<void>;

  /**
   * Update a resource with optimistic update
   */
  updateResource: (id: string, updates: UpdateResourceParams) => Promise<void>;
}

let syncEngineInstance: ResourceSyncEngine | null = null;

export const createResourceSlice: StateCreator<
  FileStore,
  [['zustand/devtools', never]],
  [],
  ResourceAction & ResourceState
> = (set, get) => {
  // Initialize sync engine (singleton per store instance)
  const getSyncEngine = () => {
    if (!syncEngineInstance) {
      syncEngineInstance = new ResourceSyncEngine(
        () => {
          const state = get();
          return {
            resourceList: state.resourceList || [],
            resourceMap: state.resourceMap || new Map(),
            syncQueue: state.syncQueue || [],
            syncingIds: state.syncingIds || new Set(),
          };
        },
        (partial) => {
          set(partial as any, false, 'syncEngine/update');
        },
      );
    }
    return syncEngineInstance;
  };

  return {
    ...initialResourceState,

    clearResources: () => {
      set(
        {
          hasMore: false,
          offset: 0,
          queryParams: undefined,
          resourceList: [],
          resourceMap: new Map(),
          syncQueue: [],
          total: 0,
        },
        false,
        'clearResources',
      );
    },

    createResource: async (params) => {
      const tempId = `temp-resource-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

      // 1. Create optimistic resource
      const optimisticResource: ResourceItem = {
        _optimistic: { isPending: true, retryCount: 0 },
        createdAt: new Date(),
        fileType: params.fileType,
        id: tempId,
        knowledgeBaseId: params.knowledgeBaseId,
        name: 'title' in params ? params.title : params.name,
        parentId: params.parentId,
        size: 'size' in params ? params.size : 0,
        sourceType: params.sourceType,
        updatedAt: new Date(),
        ...(params.sourceType === 'file'
          ? {
              url: 'url' in params ? params.url : '',
            }
          : {
              content: 'content' in params ? params.content : '',
              editorData: 'editorData' in params ? params.editorData : {},
              slug: 'slug' in params ? params.slug : undefined,
              title: 'title' in params ? params.title : 'Untitled',
            }),
        metadata: params.metadata,
      };

      // 2. Update store immediately (UI instant feedback)
      const { resourceMap, resourceList } = get();
      const newMap = new Map(resourceMap);
      newMap.set(tempId, optimisticResource);

      set(
        {
          resourceList: [optimisticResource, ...resourceList],
          resourceMap: newMap,
        },
        false,
        'createResource/optimistic',
      );

      // 3. Enqueue sync (background)
      const syncEngine = getSyncEngine();
      syncEngine.enqueue({
        id: `sync-${tempId}`,
        payload: params,
        resourceId: tempId,
        retryCount: 0,
        timestamp: new Date(),
        type: 'create',
      });

      return tempId;
    },

    createResourceAndSync: async (params) => {
      const tempId = `temp-resource-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

      // 1. Create optimistic resource
      const optimisticResource: ResourceItem = {
        _optimistic: { isPending: true, retryCount: 0 },
        createdAt: new Date(),
        fileType: params.fileType,
        id: tempId,
        knowledgeBaseId: params.knowledgeBaseId,
        name: 'title' in params ? params.title : params.name,
        parentId: params.parentId,
        size: 'size' in params ? params.size : 0,
        sourceType: params.sourceType,
        updatedAt: new Date(),
        ...(params.sourceType === 'file'
          ? {
              url: 'url' in params ? params.url : '',
            }
          : {
              content: 'content' in params ? params.content : '',
              editorData: 'editorData' in params ? params.editorData : {},
              slug: 'slug' in params ? params.slug : undefined,
              title: 'title' in params ? params.title : 'Untitled',
            }),
        metadata: params.metadata,
      };

      // 2. Update store immediately (UI instant feedback)
      const { resourceMap, resourceList } = get();
      const newMap = new Map(resourceMap);
      newMap.set(tempId, optimisticResource);

      set(
        {
          resourceList: [optimisticResource, ...resourceList],
          resourceMap: newMap,
        },
        false,
        'createResourceAndSync/optimistic',
      );

      // 3. Enqueue sync and wait for completion
      const syncEngine = getSyncEngine();
      const realId = await syncEngine.enqueue({
        id: `sync-${tempId}`,
        payload: params,
        resourceId: tempId,
        retryCount: 0,
        timestamp: new Date(),
        type: 'create',
      });

      return (realId as string) || tempId;
    },

    deleteResource: async (id) => {
      // 1. Remove immediately (optimistic)
      const { resourceMap, resourceList } = get();
      const newMap = new Map(resourceMap);
      newMap.delete(id);

      log('deleteResource', id, newMap, resourceList);

      set(
        {
          resourceList: resourceList.filter((r) => r.id !== id),
          resourceMap: newMap,
        },
        false,
        'deleteResource/optimistic',
      );

      // 2. Enqueue sync (background)
      const syncEngine = getSyncEngine();
      syncEngine.enqueue({
        id: `sync-${id}-${Date.now()}`,
        payload: {},
        resourceId: id,
        retryCount: 0,
        timestamp: new Date(),
        type: 'delete',
      });

      log('enqueue deleteResource', id, syncEngine);
    },

    flushSync: async () => {
      const syncEngine = getSyncEngine();
      await syncEngine.flush();
    },

    loadMoreResources: async () => {
      const { offset, queryParams, hasMore } = get();
      if (!hasMore || !queryParams) return;

      set({ isLoadingMore: true }, false, 'loadMoreResources/start');

      try {
        const { items } = await resourceService.queryResources({
          ...queryParams,
          limit: 50,
          offset,
        });

        // Merge into existing map/list
        const { resourceMap, resourceList } = get();
        const newMap = new Map(resourceMap);
        items.forEach((item) => newMap.set(item.id, item));

        set(
          {
            hasMore: items.length === 50,
            isLoadingMore: false,
            offset: offset + items.length,
            resourceList: [...resourceList, ...items],
            resourceMap: newMap,
          },
          false,
          'loadMoreResources/success',
        );
      } catch (error) {
        set({ isLoadingMore: false }, false, 'loadMoreResources/error');
        throw error;
      }
    },

    moveResource: async (id, parentId) => {
      // 1. Optimistically remove from current view (it's moving away)
      const { resourceMap, resourceList } = get();
      const existing = resourceMap.get(id);

      if (!existing) {
        console.warn(`Resource ${id} not found for move`);
        return;
      }

      // Remove from list and map immediately
      const newMap = new Map(resourceMap);
      newMap.delete(id);

      set(
        {
          resourceList: resourceList.filter((r) => r.id !== id),
          resourceMap: newMap,
        },
        false,
        'moveResource/optimistic',
      );

      // 2. Enqueue move operation (background sync) and wait for it to complete
      const syncEngine = getSyncEngine();
      return syncEngine.enqueue({
        id: `sync-move-${id}-${Date.now()}`,
        payload: { parentId },
        resourceId: id,
        retryCount: 0,
        timestamp: new Date(),
        type: 'move',
      });
    },

    retrySync: async (resourceId) => {
      // Find the resource and re-enqueue if it has an error
      const { resourceMap } = get();
      const resource = resourceMap.get(resourceId);

      if (resource?._optimistic?.error) {
        // Clear error state
        const updated = {
          ...resource,
          _optimistic: {
            isPending: true,
            retryCount: 0,
          },
        };

        const newMap = new Map(resourceMap);
        newMap.set(resourceId, updated);

        const { resourceList } = get();
        const listIndex = resourceList.findIndex((r) => r.id === resourceId);
        const newList = [...resourceList];
        if (listIndex >= 0) {
          newList[listIndex] = updated;
        }

        set(
          {
            resourceList: newList,
            resourceMap: newMap,
          },
          false,
          'retrySync',
        );

        // Re-enqueue the operation
        // Note: We need to reconstruct the original operation
        // For now, we'll just try an update operation
        const syncEngine = getSyncEngine();
        syncEngine.enqueue({
          id: `sync-retry-${resourceId}-${Date.now()}`,
          payload: {}, // Empty update to trigger re-sync
          resourceId,
          retryCount: 0,
          timestamp: new Date(),
          type: 'update',
        });
      }
    },

    updateResource: async (id, updates) => {
      // 1. Apply updates immediately (optimistic)
      const { resourceMap, resourceList } = get();
      const existing = resourceMap.get(id);

      if (!existing) {
        console.warn(`Resource ${id} not found for update`);
        return;
      }

      log('updateResource', id, existing, updates);

      const updated: ResourceItem = {
        ...existing,
        ...updates,
        _optimistic: { isPending: true, retryCount: 0 },
        name: updates.name || updates.title || existing.name,
        updatedAt: new Date(),
      };

      const newMap = new Map(resourceMap);
      newMap.set(id, updated);

      const listIndex = resourceList.findIndex((r) => r.id === id);
      const newList = [...resourceList];
      if (listIndex >= 0) {
        newList[listIndex] = updated;
      }

      set(
        {
          resourceList: newList,
          resourceMap: newMap,
        },
        false,
        'updateResource/optimistic',
      );

      // 2. Enqueue sync (background)
      const syncEngine = getSyncEngine();
      syncEngine.enqueue({
        id: `sync-${id}-${Date.now()}`,
        payload: updates,
        resourceId: id,
        retryCount: 0,
        timestamp: new Date(),
        type: 'update',
      });

      log('enqueue updateResource', id, syncEngine);
    },
  };
};

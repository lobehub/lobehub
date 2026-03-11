import debug from 'debug';

import { documentService } from '@/services/document';
import { fileService } from '@/services/file';
import { resourceService } from '@/services/resource';
import { type StoreSetter } from '@/store/types';
import {
  type CreateResourceParams,
  type ResourceItem,
  type UpdateResourceParams,
} from '@/types/resource';

import { type FileStore } from '../../store';
import { type ResourceState } from './initialState';
import { initialResourceState } from './initialState';
import { ResourceSyncEngine } from './syncEngine';

const log = debug('resource-manager:action');

let syncEngineInstance: ResourceSyncEngine | null = null;

type Setter = StoreSetter<FileStore>;
export const createResourceSlice = (set: Setter, get: () => FileStore, _api?: unknown) => ({
  ...initialResourceState,
  ...new ResourceActionImpl(set, get, _api),
});

export class ResourceActionImpl {
  readonly #get: () => FileStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => FileStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  #getSyncEngine = () => {
    if (!syncEngineInstance) {
      syncEngineInstance = new ResourceSyncEngine(
        () => {
          const state = this.#get();
          return {
            resourceList: state.resourceList || [],
            resourceMap: state.resourceMap || new Map(),
            syncQueue: state.syncQueue || [],
            syncingIds: state.syncingIds || new Set(),
          };
        },
        (partial) => {
          this.#set(partial as any, false, 'syncEngine/update');
        },
      );
    }
    return syncEngineInstance;
  };

  /**
   * Clear all resources and reset state
   */
  clearResources = (): void => {
    this.#set(
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
  };

  /**
   * Create a new resource with optimistic update
   * Returns temp ID for immediate UI feedback
   */
  createResource = async (params: CreateResourceParams): Promise<string> => {
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
    const { resourceMap, resourceList } = this.#get();
    const newMap = new Map(resourceMap);
    newMap.set(tempId, optimisticResource);

    this.#set(
      {
        resourceList: [optimisticResource, ...resourceList],
        resourceMap: newMap,
      },
      false,
      'createResource/optimistic',
    );

    // 3. Enqueue sync (background)
    const syncEngine = this.#getSyncEngine();
    syncEngine.enqueue({
      id: `sync-${tempId}`,
      payload: params,
      resourceId: tempId,
      retryCount: 0,
      timestamp: new Date(),
      type: 'create',
    });

    return tempId;
  };

  /**
   * Create a new resource and wait for sync to complete
   * Returns real ID from server (useful for auto-rename after creation)
   */
  createResourceAndSync = async (params: CreateResourceParams): Promise<string> => {
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
    const { resourceMap, resourceList } = this.#get();
    const newMap = new Map(resourceMap);
    newMap.set(tempId, optimisticResource);

    this.#set(
      {
        resourceList: [optimisticResource, ...resourceList],
        resourceMap: newMap,
      },
      false,
      'createResourceAndSync/optimistic',
    );

    // 3. Enqueue sync and wait for completion
    const syncEngine = this.#getSyncEngine();
    const realId = await syncEngine.enqueue({
      id: `sync-${tempId}`,
      payload: params,
      resourceId: tempId,
      retryCount: 0,
      timestamp: new Date(),
      type: 'create',
    });

    return (realId as string) || tempId;
  };

  /**
   * Delete a resource with optimistic update
   */
  deleteResource = async (id: string): Promise<void> => {
    const { resourceList, resourceMap } = this.#get();
    const newMap = new Map(resourceMap);
    newMap.delete(id);

    log('deleteResource', id, newMap, resourceList);

    this.#set(
      {
        resourceList: resourceList.filter((item) => item.id !== id),
        resourceMap: newMap,
      },
      false,
      'deleteResource/optimistic',
    );

    const syncEngine = this.#getSyncEngine();
    await syncEngine.enqueue({
      id: `sync-${id}-${Date.now()}`,
      payload: {},
      resourceId: id,
      retryCount: 0,
      timestamp: new Date(),
      type: 'delete',
    });

    log('enqueue deleteResource', id, syncEngine);
  };

  deleteResources = async (ids: string[]) => {
    if (ids.length === 0) return;

    // 1. Read sourceType from resourceMap for each ID (client-side, no API call)
    const { resourceMap, resourceList } = this.#get();
    const fileIds: string[] = [];
    const documentIds: string[] = [];

    for (const id of ids) {
      const resource = resourceMap.get(id);
      if (resource?.sourceType === 'document') {
        documentIds.push(id);
      } else {
        fileIds.push(id);
      }
    }

    // 2. Optimistically remove all items from store in one set() call
    const idsSet = new Set(ids);
    const newMap = new Map(resourceMap);
    for (const id of ids) {
      newMap.delete(id);
    }

    this.#set(
      {
        resourceList: resourceList.filter((r) => !idsSet.has(r.id)),
        resourceMap: newMap,
      },
      false,
      'deleteResources/optimistic',
    );

    // 3. Fire batch delete APIs in background (no await — UI already updated)
    const promises: Promise<void>[] = [];
    if (fileIds.length > 0) promises.push(fileService.removeFiles(fileIds));
    if (documentIds.length > 0) promises.push(documentService.deleteDocuments(documentIds));

    Promise.all(promises).catch((error) => {
      console.error('Failed to delete resources:', error);
    });
  };

  /**
   * Flush pending sync operations immediately
   */
  flushSync = async (): Promise<void> => {
    const syncEngine = this.#getSyncEngine();
    await syncEngine.flush();
  };

  /**
   * Load more resources (pagination)
   */
  loadMoreResources = async (): Promise<void> => {
    const { offset, queryParams, hasMore } = this.#get();
    if (!hasMore || !queryParams) return;

    this.#set({ isLoadingMore: true }, false, 'loadMoreResources/start');

    try {
      const { items } = await resourceService.queryResources({
        ...queryParams,
        limit: 50,
        offset,
      });

      const { resourceMap, resourceList } = this.#get();
      const newMap = new Map(resourceMap);
      items.forEach((item) => newMap.set(item.id, item));

      this.#set(
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
      this.#set({ isLoadingMore: false }, false, 'loadMoreResources/error');
      throw error;
    }
  };

  /**
   * Move a resource to a different parent folder
   */
  moveResource = async (id: string, parentId: string | null): Promise<void> => {
    const { resourceMap, resourceList } = this.#get();
    const existing = resourceMap.get(id);

    if (!existing) {
      console.warn(`Resource ${id} not found for move`);
      return;
    }

    const newMap = new Map(resourceMap);
    newMap.delete(id);

    this.#set(
      {
        resourceList: resourceList.filter((item) => item.id !== id),
        resourceMap: newMap,
      },
      false,
      'moveResource/optimistic',
    );

    const syncEngine = this.#getSyncEngine();
    await syncEngine.enqueue({
      id: `sync-move-${id}-${Date.now()}`,
      payload: { parentId },
      resourceId: id,
      retryCount: 0,
      timestamp: new Date(),
      type: 'move',
    });
  };

  /**
   * Retry a failed sync operation
   */
  retrySync = async (resourceId: string): Promise<void> => {
    const { resourceMap } = this.#get();
    const resource = resourceMap.get(resourceId);

    if (resource?._optimistic?.error) {
      const updated: ResourceItem = {
        ...resource,
        _optimistic: {
          isPending: true,
          retryCount: 0,
        },
      };

      const newMap = new Map(resourceMap);
      newMap.set(resourceId, updated);

      const { resourceList } = this.#get();
      const listIndex = resourceList.findIndex((item) => item.id === resourceId);
      const newList = [...resourceList];
      if (listIndex >= 0) {
        newList[listIndex] = updated;
      }

      this.#set(
        {
          resourceList: newList,
          resourceMap: newMap,
        },
        false,
        'retrySync',
      );

      const syncEngine = this.#getSyncEngine();
      syncEngine.enqueue({
        id: `sync-retry-${resourceId}-${Date.now()}`,
        payload: {},
        resourceId,
        retryCount: 0,
        timestamp: new Date(),
        type: 'update',
      });
    }
  };

  /**
   * Update a resource with optimistic update
   */
  updateResource = async (id: string, updates: UpdateResourceParams): Promise<void> => {
    const { resourceMap, resourceList } = this.#get();
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

    const listIndex = resourceList.findIndex((item) => item.id === id);
    const newList = [...resourceList];
    if (listIndex >= 0) {
      newList[listIndex] = updated;
    }

    this.#set(
      {
        resourceList: newList,
        resourceMap: newMap,
      },
      false,
      'updateResource/optimistic',
    );

    const syncEngine = this.#getSyncEngine();
    syncEngine.enqueue({
      id: `sync-${id}-${Date.now()}`,
      payload: updates,
      resourceId: id,
      retryCount: 0,
      timestamp: new Date(),
      type: 'update',
    });

    log('enqueue updateResource', id, syncEngine);
  };
}

export type ResourceAction = Pick<ResourceActionImpl, keyof ResourceActionImpl>;
export type ResourceSlice = ResourceAction & ResourceState;

import debug from 'debug';

import { knowledgeBaseService } from '@/services/knowledgeBase';
import { resourceService } from '@/services/resource';
import type { StoreSetter } from '@/store/types';
import { OptimisticEngine } from '@/store/utils/optimisticEngine';
import type { CreateResourceParams, ResourceItem, UpdateResourceParams } from '@/types/resource';

import type { FileStore } from '../../store';
import type { ResourceState } from './initialState';
import { initialResourceState } from './initialState';
import { getResourceQueryKey } from './utils';

const log = debug('resource-manager:action');

interface ResourceStoreState extends Pick<
  ResourceState,
  | 'hasMore'
  | 'isLoadingMore'
  | 'isSyncing'
  | 'lastSyncTime'
  | 'offset'
  | 'queryParams'
  | 'resourceList'
  | 'resourceMap'
  | 'syncError'
  | 'syncQueue'
  | 'syncingIds'
  | 'total'
> {}

type Setter = StoreSetter<FileStore>;

export const createResourceSlice = (set: Setter, get: () => FileStore, api?: unknown) =>
  new ResourceActionImpl(set, get, api);

const toError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

export class ResourceActionImpl {
  readonly #get: () => FileStore;
  readonly #resourceStoreHandle: {
    getState: () => ResourceStoreState;
    setState: (nextState: ResourceStoreState) => void;
  };
  readonly #set: Setter;
  #syncEngine?: OptimisticEngine<ResourceStoreState>;

  constructor(set: Setter, get: () => FileStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#set = set;
    this.#resourceStoreHandle = {
      getState: () => {
        const state = this.#get();

        return {
          hasMore: state.hasMore,
          isLoadingMore: state.isLoadingMore,
          isSyncing: state.isSyncing,
          lastSyncTime: state.lastSyncTime,
          offset: state.offset,
          queryParams: state.queryParams,
          resourceList: state.resourceList,
          resourceMap: state.resourceMap,
          syncError: state.syncError,
          syncQueue: state.syncQueue,
          syncingIds: state.syncingIds,
          total: state.total,
        };
      },
      setState: (nextState) => {
        this.#set(nextState as Partial<FileStore>, false, 'resourceSyncEngine/setState');
      },
    };
  }

  #clearSyncingId = (id: string) => {
    this.#set(
      (state) => {
        if (!state.syncingIds.has(id)) return {};

        const syncingIds = new Set(state.syncingIds);
        syncingIds.delete(id);

        return { syncingIds };
      },
      false,
      'resource/clearSyncingId',
    );
  };

  #clearResourceOptimisticState = (resource: ResourceItem): ResourceItem => {
    const { _optimistic, ...rest } = resource;

    void _optimistic;

    return rest;
  };

  #createOptimisticResource = (params: CreateResourceParams, id?: string): ResourceItem => ({
    _optimistic: {
      isPending: true,
      queryKey: getResourceQueryKey(this.#get().queryParams),
      retryCount: 0,
    },
    createdAt: new Date(),
    fileType: params.fileType,
    id: id || `temp-resource-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    knowledgeBaseId: params.knowledgeBaseId,
    metadata: params.metadata,
    name: 'title' in params ? params.title : params.name,
    parentId: params.parentId,
    size: 'size' in params ? params.size : 0,
    sourceType: params.sourceType,
    updatedAt: new Date(),
    ...(params.sourceType === 'file'
      ? {
          url: params.url,
        }
      : {
          content: params.content,
          editorData: params.editorData ?? {},
          slug: params.slug,
          title: params.title,
        }),
  });

  #getSyncEngine = () => {
    if (this.#syncEngine) return this.#syncEngine;

    this.#syncEngine = new OptimisticEngine(this.#resourceStoreHandle, {
      maxRetries: 1,
      onMutationError: (_snapshot, error) => {
        this.#set(
          {
            syncError: toError(error),
          },
          false,
          'resourceSyncEngine/error',
        );
      },
      onMutationSuccess: () => {
        this.#set(
          {
            lastSyncTime: new Date(),
            syncError: undefined,
          },
          false,
          'resourceSyncEngine/success',
        );
      },
      onQueueChange: (snapshots) => {
        this.#set(
          {
            isSyncing: snapshots.some(
              (item) => item.status === 'pending' || item.status === 'inflight',
            ),
            syncQueue: snapshots,
          },
          false,
          'resourceSyncEngine/queueChange',
        );
      },
    });

    return this.#syncEngine;
  };

  #replaceLocalResource = (targetId: string, resource: ResourceItem) => {
    const { resourceList, resourceMap } = this.#get();
    const nextMap = new Map(resourceMap);
    nextMap.delete(targetId);
    nextMap.set(resource.id, resource);

    const targetIndex = resourceList.findIndex((item) => item.id === targetId);
    const nextList = resourceList.filter((item) => item.id !== targetId && item.id !== resource.id);
    // If the replaced item was already visible, keep the replacement visible too.
    // This avoids slug-vs-UUID mismatches when queryParams.parentId is a slug
    // but resource.parentId is a UUID and the parent folder isn't in resourceMap.
    const shouldInsert = targetIndex !== -1 || this.#isResourceVisibleInCurrentQuery(resource);

    if (shouldInsert) {
      const insertIndex = targetIndex === -1 ? 0 : Math.min(targetIndex, nextList.length);
      nextList.splice(insertIndex, 0, resource);
    }

    this.#set(
      {
        resourceList: nextList,
        resourceMap: nextMap,
      },
      false,
      'resource/replaceLocalResource',
    );
  };

  #isResourceVisibleInCurrentQuery = (resource: ResourceItem): boolean => {
    const { queryParams, resourceMap } = this.#get();

    if (!queryParams) return false;

    if (
      queryParams.libraryId !== undefined &&
      (resource.knowledgeBaseId ?? undefined) !== queryParams.libraryId
    ) {
      return false;
    }

    const keyword = queryParams.q?.trim().toLowerCase();
    if (keyword) {
      const candidate = `${resource.name} ${resource.title ?? ''}`.trim().toLowerCase();
      if (!candidate.includes(keyword)) return false;
    }

    if (queryParams.parentId == null) {
      return (resource.parentId ?? null) === null;
    }

    if (!resource.parentId) return false;
    if (resource.parentId === queryParams.parentId) return true;

    const parentResource = resourceMap.get(resource.parentId);
    return parentResource?.slug === queryParams.parentId;
  };

  #patchLocalResourceEntries = (
    ids: Set<string>,
    updater: (resource: ResourceItem) => ResourceItem | null,
    actionName: string,
    onComplete?: (draft: ResourceStoreState, meta: { visibleChangedCount: number }) => void,
  ) => {
    this.#set(
      (state) => {
        if (ids.size === 0) return {};

        const resourceMap = new Map(state.resourceMap);
        let changed = false;
        let visibleChangedCount = 0;

        const resourceList = state.resourceList.flatMap((item) => {
          if (!ids.has(item.id)) return [item];

          const nextItem = updater(resourceMap.get(item.id) ?? item);

          visibleChangedCount += 1;
          changed = true;

          if (!nextItem) {
            resourceMap.delete(item.id);
            return [];
          }

          resourceMap.set(nextItem.id, nextItem);
          return [nextItem];
        });

        for (const id of ids) {
          if (state.resourceList.some((item) => item.id === id)) continue;

          const existing = resourceMap.get(id);
          if (!existing) continue;

          const nextItem = updater(existing);
          changed = true;

          if (!nextItem) {
            resourceMap.delete(id);
            continue;
          }

          resourceMap.set(nextItem.id, nextItem);
        }

        if (!changed) return {};

        const draft: ResourceStoreState = {
          ...state,
          resourceList,
          resourceMap,
        };

        onComplete?.(draft, { visibleChangedCount });

        return draft;
      },
      false,
      actionName,
    );
  };

  #toPendingResource = (resource: ResourceItem, patch?: Partial<ResourceItem>): ResourceItem => ({
    ...resource,
    ...patch,
    _optimistic: {
      ...(resource._optimistic || {
        queryKey: getResourceQueryKey(this.#get().queryParams),
        retryCount: 0,
      }),
      isPending: true,
    },
    updatedAt: patch?.updatedAt ?? new Date(),
  });

  clearResources = (): void => {
    this.#set(
      {
        ...initialResourceState,
      },
      false,
      'resource/clearResources',
    );
  };

  clearCurrentQueryResources = (): void => {
    this.#set(
      (state) => {
        const visibleIds = new Set(state.resourceList.map((item) => item.id));
        const syncingIds = new Set(
          Array.from(state.syncingIds).filter((id) => !visibleIds.has(id)),
        );

        // Preserve off-screen optimistic items from other queries
        const preservedMap = new Map<string, ResourceItem>();
        for (const [id, item] of state.resourceMap) {
          if (!visibleIds.has(id) && item._optimistic) {
            preservedMap.set(id, item);
          }
        }

        return {
          hasMore: false,
          offset: 0,
          resourceList: [],
          resourceMap: preservedMap,
          syncingIds,
          total: 0,
        };
      },
      false,
      'resource/clearCurrentQueryResources',
    );
  };

  createResource = async (params: CreateResourceParams): Promise<string> => {
    const optimisticResource = this.#createOptimisticResource(params);
    const syncEngine = this.#getSyncEngine();
    const tx = syncEngine.createTransaction(`createResource(${optimisticResource.id})`);

    tx.set((draft) => {
      draft.resourceList.unshift(optimisticResource);
      draft.resourceMap.set(optimisticResource.id, optimisticResource);
      draft.syncingIds.add(optimisticResource.id);
    });
    tx.mutation = () => resourceService.createResource(params);
    tx.onSuccess = async (result) => {
      this.#replaceLocalResource(optimisticResource.id, result as ResourceItem);
      this.#clearSyncingId(optimisticResource.id);
    };
    tx.onError = async (error) => {
      this.#clearSyncingId(optimisticResource.id);
      this.markLocalResourceError(optimisticResource.id, toError(error));
    };

    void tx.commit<ResourceItem>().catch((error) => {
      console.error('Failed to create resource:', error);
    });

    return optimisticResource.id;
  };

  createResourceAndSync = async (params: CreateResourceParams): Promise<string> => {
    const optimisticResource = this.#createOptimisticResource(params);
    const syncEngine = this.#getSyncEngine();
    const tx = syncEngine.createTransaction(`createResourceAndSync(${optimisticResource.id})`);

    tx.set((draft) => {
      draft.resourceList.unshift(optimisticResource);
      draft.resourceMap.set(optimisticResource.id, optimisticResource);
      draft.syncingIds.add(optimisticResource.id);
    });
    tx.mutation = () => resourceService.createResource(params);
    tx.onSuccess = async (result) => {
      this.#replaceLocalResource(optimisticResource.id, result as ResourceItem);
      this.#clearSyncingId(optimisticResource.id);
    };
    tx.onError = async (error) => {
      this.#clearSyncingId(optimisticResource.id);
      this.markLocalResourceError(optimisticResource.id, toError(error));
    };

    const created = await tx.commit<ResourceItem>();
    return created.id;
  };

  deleteResource = async (id: string): Promise<void> => {
    const syncEngine = this.#getSyncEngine();
    const tx = syncEngine.createTransaction(`deleteResource(${id})`);

    tx.set((draft) => {
      draft.resourceList = draft.resourceList.filter((item) => item.id !== id);
      draft.resourceMap.delete(id);
    });
    tx.mutation = () => resourceService.deleteResource(id);

    await tx.commit<void>();
  };

  deleteResources = async (ids: string[]) => {
    if (ids.length === 0) return;

    const idsSet = new Set(ids);
    const syncEngine = this.#getSyncEngine();
    const tx = syncEngine.createTransaction(`deleteResources(${ids.join(',')})`);

    tx.set((draft) => {
      draft.resourceList = draft.resourceList.filter((item) => !idsSet.has(item.id));
      for (const id of idsSet) {
        draft.resourceMap.delete(id);
      }
    });
    tx.mutation = () => resourceService.deleteResources(ids);

    await tx.commit<void>();
  };

  flushSync = async (): Promise<void> => {
    await this.#getSyncEngine().flush();
  };

  insertLocalResource = (params: CreateResourceParams, id?: string): string => {
    const optimisticResource = this.#createOptimisticResource(params, id);

    this.#set(
      (state) => {
        const resourceMap = new Map(state.resourceMap);
        resourceMap.set(optimisticResource.id, optimisticResource);

        return {
          resourceList: [optimisticResource, ...state.resourceList],
          resourceMap,
        };
      },
      false,
      'resource/insertLocalResource',
    );

    return optimisticResource.id;
  };

  patchLocalResource = (
    id: string,
    updates: Partial<ResourceItem>,
    actionName: string = 'resource/patchLocalResource',
  ): void => {
    this.#patchLocalResourceEntries(
      new Set([id]),
      (resource) => ({
        ...resource,
        ...updates,
      }),
      actionName,
    );
  };

  patchLocalResourceStatuses = (
    items: Array<
      Pick<
        ResourceItem,
        | 'id'
        | 'chunkCount'
        | 'chunkingError'
        | 'chunkingStatus'
        | 'embeddingError'
        | 'embeddingStatus'
        | 'finishEmbedding'
      >
    >,
  ): void => {
    if (items.length === 0) return;

    const statusMap = new Map(items.map((item) => [item.id, item]));

    this.#patchLocalResourceEntries(
      new Set(statusMap.keys()),
      (resource) => {
        const patch = statusMap.get(resource.id);
        if (!patch) return resource;

        return {
          ...resource,
          chunkCount: patch.chunkCount !== undefined ? patch.chunkCount : resource.chunkCount,
          chunkingError:
            patch.chunkingError !== undefined ? patch.chunkingError : resource.chunkingError,
          chunkingStatus:
            patch.chunkingStatus !== undefined ? patch.chunkingStatus : resource.chunkingStatus,
          embeddingError:
            patch.embeddingError !== undefined ? patch.embeddingError : resource.embeddingError,
          embeddingStatus:
            patch.embeddingStatus !== undefined ? patch.embeddingStatus : resource.embeddingStatus,
          finishEmbedding:
            patch.finishEmbedding !== undefined ? patch.finishEmbedding : resource.finishEmbedding,
        };
      },
      'resource/patchLocalResourceStatuses',
    );
  };

  loadMoreResources = async (): Promise<void> => {
    const { hasMore, offset, queryParams } = this.#get();
    if (!hasMore || !queryParams) return;

    this.#set({ isLoadingMore: true }, false, 'resource/loadMoreResources/start');

    try {
      const { items } = await resourceService.queryResources({
        ...queryParams,
        limit: 50,
        offset,
      });

      this.#set(
        (state) => {
          const existingIds = new Set(state.resourceList.map((item) => item.id));
          const resourceMap = new Map(state.resourceMap);

          for (const item of items) {
            resourceMap.set(item.id, item);
          }

          return {
            hasMore: items.length === 50,
            isLoadingMore: false,
            offset: offset + items.length,
            resourceList: [
              ...state.resourceList,
              ...items.filter((item) => !existingIds.has(item.id)),
            ],
            resourceMap,
          };
        },
        false,
        'resource/loadMoreResources/success',
      );
    } catch (error) {
      this.#set({ isLoadingMore: false }, false, 'resource/loadMoreResources/error');
      throw error;
    }
  };

  markLocalResourceError = (id: string, error: Error): void => {
    const { resourceMap } = this.#get();
    const resource = resourceMap.get(id);
    if (!resource) return;

    const nextResource: ResourceItem = {
      ...resource,
      _optimistic: {
        ...(resource._optimistic || {
          isPending: false,
          queryKey: getResourceQueryKey(this.#get().queryParams),
          retryCount: 0,
        }),
        error,
        isPending: false,
        lastSyncAttempt: new Date(),
      },
    };

    this.#set(
      (state) => {
        const resourceMap = new Map(state.resourceMap);
        resourceMap.set(id, nextResource);

        return {
          resourceList: state.resourceList.map((item) => (item.id === id ? nextResource : item)),
          resourceMap,
        };
      },
      false,
      'resource/markLocalResourceError',
    );
  };

  moveResource = async (id: string, parentId: string | null): Promise<void> => {
    const { queryParams, resourceMap } = this.#get();
    const existing = resourceMap.get(id);

    if (!existing) {
      console.warn(`Resource ${id} not found for move`);
      return;
    }

    if ((existing.parentId ?? null) === parentId) return;

    const syncEngine = this.#getSyncEngine();
    const tx = syncEngine.createTransaction(`moveResource(${id})`);
    const movedResource: ResourceItem = {
      ...existing,
      _optimistic: {
        ...(existing._optimistic || {
          queryKey: getResourceQueryKey(this.#get().queryParams),
          retryCount: 0,
        }),
        isPending: true,
      },
      parentId,
      updatedAt: new Date(),
    };
    const shouldKeepVisible = !queryParams || this.#isResourceVisibleInCurrentQuery(movedResource);

    tx.set((draft) => {
      if (shouldKeepVisible) {
        draft.resourceMap.set(id, movedResource);
        draft.resourceList = draft.resourceList.map((item) =>
          item.id === id ? movedResource : item,
        );
        return;
      }

      draft.resourceList = draft.resourceList.filter((item) => item.id !== id);
      draft.resourceMap.delete(id);
    });
    tx.mutation = () => resourceService.moveResource(id, parentId);
    tx.onSuccess = async (result) => {
      if (!shouldKeepVisible) return;
      this.#replaceLocalResource(id, result as ResourceItem);
    };

    await tx.commit<ResourceItem>();
  };

  removeLocalResource = (id: string): void => {
    this.#set(
      (state) => {
        const resourceMap = new Map(state.resourceMap);
        resourceMap.delete(id);

        return {
          resourceList: state.resourceList.filter((item) => item.id !== id),
          resourceMap,
        };
      },
      false,
      'resource/removeLocalResource',
    );
  };

  replaceLocalResource = (tempId: string, resource: ResourceItem): void => {
    this.#replaceLocalResource(tempId, resource);
  };

  retrySync = async (): Promise<void> => {
    await this.flushSync();
  };

  addResourcesToKnowledgeBase = async (knowledgeBaseId: string, ids: string[]): Promise<void> => {
    if (ids.length === 0) return;

    const idsSet = new Set(ids);
    const syncEngine = this.#getSyncEngine();
    const tx = syncEngine.createTransaction(`addResourcesToKnowledgeBase(${knowledgeBaseId})`);

    tx.set((draft) => {
      for (const item of draft.resourceList) {
        if (!idsSet.has(item.id)) continue;

        const nextItem = this.#toPendingResource(item, { knowledgeBaseId });
        draft.resourceMap.set(item.id, nextItem);
      }

      draft.resourceList = draft.resourceList.map((item) => {
        if (!idsSet.has(item.id)) return item;
        return draft.resourceMap.get(item.id) ?? item;
      });
    });
    tx.mutation = () => knowledgeBaseService.addFilesToKnowledgeBase(knowledgeBaseId, ids);
    tx.onSuccess = async () => {
      this.#patchLocalResourceEntries(
        idsSet,
        (resource) => this.#clearResourceOptimisticState({ ...resource, knowledgeBaseId }),
        'resource/addResourcesToKnowledgeBase/success',
      );
    };

    await tx.commit<void>();
  };

  removeResourcesFromKnowledgeBase = async (
    knowledgeBaseId: string,
    ids: string[],
  ): Promise<void> => {
    if (ids.length === 0) return;

    const idsSet = new Set(ids);
    const isKnowledgeBaseView = this.#get().queryParams?.libraryId === knowledgeBaseId;
    const syncEngine = this.#getSyncEngine();
    const tx = syncEngine.createTransaction(`removeResourcesFromKnowledgeBase(${knowledgeBaseId})`);

    tx.set((draft) => {
      if (isKnowledgeBaseView) {
        let visibleChangedCount = 0;

        draft.resourceList = draft.resourceList.filter((item) => {
          if (!idsSet.has(item.id)) return true;

          draft.resourceMap.delete(item.id);
          visibleChangedCount += 1;
          return false;
        });

        if (typeof draft.total === 'number') {
          draft.total = Math.max(0, draft.total - ids.length);
          draft.hasMore = draft.total > draft.resourceList.length;
        }

        draft.offset = Math.max(0, draft.offset - visibleChangedCount);
        return;
      }

      for (const item of draft.resourceList) {
        if (!idsSet.has(item.id)) continue;

        const nextItem = this.#toPendingResource(item, { knowledgeBaseId: undefined });
        draft.resourceMap.set(item.id, nextItem);
      }

      draft.resourceList = draft.resourceList.map((item) => {
        if (!idsSet.has(item.id)) return item;
        return draft.resourceMap.get(item.id) ?? item;
      });
    });
    tx.mutation = () => knowledgeBaseService.removeFilesFromKnowledgeBase(knowledgeBaseId, ids);
    tx.onSuccess = async () => {
      if (isKnowledgeBaseView) return;

      this.#patchLocalResourceEntries(
        idsSet,
        (resource) =>
          this.#clearResourceOptimisticState({
            ...resource,
            knowledgeBaseId: undefined,
          }),
        'resource/removeResourcesFromKnowledgeBase/success',
      );
    };

    await tx.commit<void>();
  };

  updateResource = async (id: string, updates: UpdateResourceParams): Promise<void> => {
    const { resourceMap } = this.#get();
    const existing = resourceMap.get(id);

    if (!existing) {
      console.warn(`Resource ${id} not found for update`);
      return;
    }

    const updated: ResourceItem = {
      ...existing,
      ...updates,
      _optimistic: {
        ...(existing._optimistic || {
          queryKey: getResourceQueryKey(this.#get().queryParams),
          retryCount: 0,
        }),
        isPending: true,
      },
      name: updates.name || updates.title || existing.name,
      updatedAt: new Date(),
    };

    log('updateResource', id, existing, updates);

    const syncEngine = this.#getSyncEngine();
    const tx = syncEngine.createTransaction(`updateResource(${id})`);

    tx.set((draft) => {
      draft.resourceMap.set(id, updated);
      draft.resourceList = draft.resourceList.map((item) => (item.id === id ? updated : item));
    });
    tx.mutation = () => resourceService.updateResource(id, updates);
    tx.onSuccess = async (result) => {
      this.#replaceLocalResource(id, result as ResourceItem);
    };

    await tx.commit<ResourceItem>();
  };
}

export type ResourceAction = Pick<ResourceActionImpl, keyof ResourceActionImpl>;

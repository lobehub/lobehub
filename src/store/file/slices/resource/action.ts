import debug from 'debug';
import { useLayoutEffect } from 'react';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { createReplicaSlice, type ReplicaLens, type ReplicaSyncResult } from '@/libs/replica';
import { knowledgeBaseService } from '@/services/knowledgeBase';
import { resourceService } from '@/services/resource';
import { type StoreSetter } from '@/store/types';
import {
  type CreateResourceParams,
  type ResourceItem,
  type ResourceQueryParams,
  type UpdateResourceParams,
} from '@/types/resource';
import { setNamespace } from '@/utils/storeDebug';

import { type FileStore, useFileStore } from '../../store';
import type { ResourceParentKey } from './hooks';
import type { ResourceListParams, ResourceListValue } from './projection';
import {
  DEFAULT_RESOURCE_PAGE_SIZE,
  normalizeResourceListParams,
  RESOURCE_LIST_KEY,
  resourceListResource,
} from './projection';
import {
  getResourceQueryKey,
  isOptimisticRowInRequestedPool,
  listsMovedRowUnfiltered,
  patchDestinationList,
  patchSourceList,
} from './utils';

const log = debug('resource-manager:action');

const n = setNamespace('resource');

type Setter = StoreSetter<FileStore>;

/**
 * The explorer list keeps a single replica entry whose view lives in the flat
 * store fields the rest of the app already reads. The engine is the only writer;
 * `get` reconstructs the paged value from the stored entry, `set` fans it back
 * out into `resourceList` / `resourceMap` / paging fields in one commit, so a
 * subscriber never sees a list out of step with its bookkeeping.
 */
const resourceListLens: ReplicaLens<FileStore, ResourceListValue> = {
  // A scope switch drops the whole view, query included.
  clear: () => ({
    hasMore: false,
    isLoadingMore: false,
    offset: 0,
    queryParams: undefined,
    resourceList: [],
    resourceListEntry: undefined,
    resourceMap: new Map(),
    total: 0,
  }),
  get: (state) => state.resourceListEntry,
  set: (_state, _key, data) => {
    if (!data) {
      // Dropping the painted rows keeps the queried params, so the views can
      // still tell that the request on screen has moved on (skeleton instead of
      // the previous pool's rows).
      return {
        hasMore: false,
        isLoadingMore: false,
        offset: 0,
        resourceList: [],
        resourceListEntry: undefined,
        resourceMap: new Map(),
        total: 0,
      };
    }

    return {
      hasMore: data.hasMore,
      isLoadingMore: data.isLoadingMore ?? false,
      offset: data.items.length,
      queryParams: data.queryParams,
      resourceList: data.items,
      resourceListEntry: data,
      resourceMap: new Map(data.items.map((item) => [item.id, item])),
      total: data.total ?? data.items.length,
    };
  },
};

const toError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

const stripOptimistic = (resource: ResourceItem): ResourceItem => {
  const { _optimistic, ...rest } = resource;
  void _optimistic;
  return rest;
};

/** The `ResourceSyncResult` plus the SWR-era aliases the explorer consumes. */
export interface ResourceListSyncResult extends ReplicaSyncResult {
  /** Nothing painted yet and a fetch is on its way (the list/masonry skeletons). */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
}

export const createResourceSlice = (set: Setter, get: () => FileStore, api?: unknown) =>
  new ResourceActionImpl(set, get, api);

export class ResourceActionImpl {
  readonly #get: () => FileStore;
  /**
   * The explorer list is a `@lobechat/replica` paged resource: the persisted
   * head page paints before the network answers, and "load more" appends further
   * pages through the engine instead of a hand-rolled `offset` accumulator.
   */
  readonly #resourceList;
  /** Query the Explorer last asked for (set every render, read by the effects). */
  #requestedListParams?: ResourceListParams;
  /** Storage row of `#requestedListParams`; a slow hydrate of another query is dropped. */
  #requestedListStorageKey?: string;
  /** Storage row the painted rows answer, so the navigation effect only runs on a change. */
  #paintedListKey?: string;

  constructor(set: Setter, get: () => FileStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#resourceList = createReplicaSlice(resourceListResource, {
      actionPrefix: n('resourceList'),
      fetcher: (params, cursor) => this.#fetchResourcePage(params, cursor),
      get,
      // A slow hydrate of a query the user has already left must not repaint the
      // list: the requested row — not whatever the store still shows — decides.
      isHydratable: (_cached, params) =>
        resourceListResource.storageKey(params) === this.#requestedListStorageKey,
      // Rows the explorer inserted locally (an in-flight upload / create) are
      // the newest and have no server row yet, so a head response for their own
      // pool — initial, focus or reconnect — must keep them instead of replacing
      // them away. One from another pool must not: the singleton entry is reused
      // by every query, so an unscoped predicate would paint folder A's upload
      // in folder B.
      isClientOnly: (item: ResourceItem) =>
        !!item._optimistic &&
        isOptimisticRowInRequestedPool(item._optimistic.queryKey, this.#requestedListParams),
      set,
      stateKey: 'resourceListReplica',
      view: resourceListLens,
      viewFields: (params) => ({ queryParams: params }),
    });
  }

  /** One page of the explorer list; `cursor` is the page index (0 = head). */
  #fetchResourcePage = async (params: ResourceListParams, cursor?: number) => {
    const { pageSize, ...query } = params;
    const limit = pageSize ?? DEFAULT_RESOURCE_PAGE_SIZE;
    const response = await resourceService.queryResources({
      ...query,
      limit,
      offset: (cursor ?? 0) * limit,
    });

    return { items: response.items, total: response.total };
  };

  // ---- row helpers --------------------------------------------------------

  #insertRow = (data: ResourceListValue, resource: ResourceItem): ResourceListValue => {
    const items = data.items.filter((item) => item.id !== resource.id);
    const added = items.length === data.items.length ? 1 : 0;

    return {
      ...data,
      items: [resource, ...items],
      total: data.total === undefined ? undefined : data.total + added,
    };
  };

  #removeRows = (data: ResourceListValue, ids: Set<string>): ResourceListValue => {
    const items = data.items.filter((item) => !ids.has(item.id));
    if (items.length === data.items.length) return data;

    const removed = data.items.length - items.length;
    const total =
      data.total === undefined ? undefined : Math.max(items.length, data.total - removed);

    return {
      ...data,
      hasMore: total !== undefined ? total > items.length : data.hasMore,
      items,
      total,
    };
  };

  #patchRow = (
    data: ResourceListValue,
    id: string,
    updater: (resource: ResourceItem) => ResourceItem | undefined,
  ): ResourceListValue => {
    let changed = false;
    const items = data.items.flatMap((item) => {
      if (item.id !== id) return [item];
      const next = updater(item);
      changed = true;
      return next ? [next] : [];
    });

    return changed ? { ...data, items } : data;
  };

  #patchRows = (
    data: ResourceListValue,
    ids: Set<string>,
    updater: (resource: ResourceItem) => ResourceItem,
  ): ResourceListValue => {
    let changed = false;
    const items = data.items.map((item) => {
      if (!ids.has(item.id)) return item;
      const next = updater(item);
      if (next !== item) changed = true;
      return next;
    });

    return changed ? { ...data, items } : data;
  };

  /** Replace a row in place (collapsing a duplicate when the server id already exists). */
  #replaceRow = (
    data: ResourceListValue,
    fromId: string,
    resource: ResourceItem,
  ): ResourceListValue => {
    const index = data.items.findIndex((item) => item.id === fromId);
    if (index === -1) {
      if (data.items.some((item) => item.id === resource.id)) {
        return this.#patchRow(data, resource.id, () => resource);
      }
      return data;
    }

    const items: ResourceItem[] = [];
    data.items.forEach((item, i) => {
      if (i === index) {
        items.push(resource);
        return;
      }
      if (item.id === resource.id) return;
      items.push(item);
    });

    return { ...data, items };
  };

  /**
   * Settle an optimistic create: the confirmation callback receives the value
   * *before* the overlay, so the temp row it must swap out is not there — the
   * created row is inserted instead (the overlay's own temp row is dropped).
   */
  #settleCreated = (
    data: ResourceListValue,
    tempId: string,
    created: ResourceItem,
  ): ResourceListValue =>
    data.items.some((item) => item.id === tempId)
      ? this.#replaceRow(data, tempId, created)
      : this.#insertRow(data, created);

  /**
   * Materialize a view for the explorer list so a local insert (upload /
   * create) has somewhere to land before the first page arrives. Rows already
   * written straight into the flat fields are adopted rather than dropped, so
   * a legacy caller (the upload path runs before any query is known) keeps
   * working; with no query at all the view is seeded query-less.
   */
  #ensureListView = (): void => {
    const state = this.#get();
    if (state.resourceListEntry) return;

    const params = state.queryParams;
    const items = state.resourceList;
    const seeded: ResourceListValue = {
      currentPage: 0,
      hasMore: state.hasMore,
      items,
      nextCursor: state.hasMore ? 1 : null,
      pageSize: params?.pageSize ?? DEFAULT_RESOURCE_PAGE_SIZE,
      queryParams: params,
      total: state.total ?? items.length,
    };

    this.#resourceList.update(RESOURCE_LIST_KEY, (data) => data ?? seeded, { persist: false });
  };

  /**
   * Replica query identity of the Explorer's current request. Tagging an
   * overlay with it scopes the overlay even when it starts before the first
   * page painted — the seeded entry has no query of its own yet, and an
   * untagged overlay would be kept across every query change (leaking one
   * folder's row into another).
   */
  #requestedListQuery = (): string | undefined =>
    this.#requestedListParams ? resourceListResource.query(this.#requestedListParams) : undefined;

  /** Optimistic overlay over the explorer list. */
  #beginListOptimistic = (apply: (data: ResourceListValue) => ResourceListValue) => {
    this.#ensureListView();
    return this.#resourceList.beginOptimistic(RESOURCE_LIST_KEY, apply, this.#requestedListQuery());
  };

  #revalidateList = async (): Promise<void> => {
    await this.#resourceList.revalidate();
  };

  /**
   * Confirm the mounted list after a mutation that the server already accepted.
   * A failed confirmation must not undo (or fail) that mutation: the rows are
   * committed, the next visit revalidates anyway, and the caller's own
   * transaction would otherwise restore a row the server has moved.
   */
  #revalidateListQuietly = async (action: string): Promise<void> => {
    try {
      await this.#revalidateList();
    } catch (error) {
      log('%s: revalidation after the mutation failed', action, error);
    }
  };

  /**
   * Settle an optimistic overlay and, when it could not be found any more — a
   * same-pool query change (re-sort, view-mode switch) drops its token — force
   * a reconciliation, so the server change is not left unreflected until the
   * next focus, reconnect or manual refresh.
   */
  #commitListOptimistic = (
    token:
      { commit: (confirm?: (data: ResourceListValue) => ResourceListValue) => boolean } | undefined,
    action: string,
    confirm?: (data: ResourceListValue) => ResourceListValue,
  ): void => {
    const settled = token?.commit(confirm);
    if (token && !settled) void this.#revalidateListQuietly(action);
  };

  #clearSyncingOptimistic = (resource: ResourceItem): ResourceItem => stripOptimistic(resource);

  #isResourceOutsideCurrentQuery = (resource: ResourceItem): boolean => {
    const { queryParams, resourceMap } = this.#get();

    if (!queryParams) return false;

    if (
      queryParams.libraryId !== undefined &&
      (resource.knowledgeBaseId ?? undefined) !== queryParams.libraryId
    ) {
      return true;
    }

    const inFolderView = queryParams.parentId != null;
    if (!inFolderView) return !!resource.parentId;
    if (!resource.parentId) return true;
    if (resource.parentId === queryParams.parentId) return false;

    const parentResource = resourceMap.get(resource.parentId);
    return !!parentResource && parentResource.slug !== queryParams.parentId;
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

  #createOptimisticResource = (params: CreateResourceParams, id?: string): ResourceItem => ({
    _optimistic: {
      isPending: true,
      // The row must read as *this* pool's on the head response, including when
      // it is inserted before the first page landed (the store's `queryParams` is
      // only set by a paint) — so stamp the pool the Explorer asked for.
      queryKey: getResourceQueryKey(this.#requestedListParams ?? this.#get().queryParams),
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
          ...(params.visibility !== undefined ? { visibility: params.visibility } : {}),
        }
      : {
          content: params.content,
          editorData: params.editorData ?? {},
          slug: params.slug,
          title: params.title,
        }),
  });

  /**
   * `queryParams.parentId` carries the folder slug from the URL while drop
   * targets and the sidebar tree address folders by id. Collect both spellings
   * for a folder from wherever it is already known client-side: the explorer's
   * own rows, the current folder, or the loaded sidebar nodes. Unknown handles
   * pass through unchanged; the root is always `null`.
   */
  #resolveParentCacheKeys = async (
    parents: Array<ResourceParentKey | undefined>,
  ): Promise<ResourceParentKey[]> => {
    const handles = parents.filter((parent): parent is string => !!parent);
    if (handles.length === 0) return [null];

    const keys = new Set<string>(handles);
    const { currentFolderId, queryParams, resourceMap } = this.#get();
    const currentSlug = queryParams?.parentId ?? null;

    const addFolder = (folder: { id: string; slug?: string | null }) => {
      keys.add(folder.id);
      if (folder.slug) keys.add(folder.slug);
    };

    for (const handle of handles) {
      const row =
        resourceMap.get(handle) ?? [...resourceMap.values()].find((item) => item.slug === handle);
      if (row) addFolder(row);

      if (currentFolderId && (handle === currentFolderId || handle === currentSlug)) {
        addFolder({ id: currentFolderId, slug: currentSlug });
      }
    }

    const { useTreeStore } = await import('@/store/tree');
    for (const items of Object.values(useTreeStore.getState().children)) {
      for (const node of items) {
        if (node.isFolder && (keys.has(node.id) || (node.slug && keys.has(node.slug)))) {
          addFolder(node);
        }
      }
    }

    return [...keys];
  };

  // ---- list lifecycle -----------------------------------------------------

  /**
   * Repaint the explorer for a new query. The entry is a singleton reused by
   * every query, and `hydrate` otherwise only fills an empty slot — so without
   * this a query change waits for the network even when its own persisted page
   * exists (a warm navigation, or any navigation while offline). Reading that
   * page with `overwrite` repaints the entry in a single write, so the views
   * never see an empty middle frame and a same-pool change (`sorter` /
   * `sortType` / view mode) stays flash-free.
   *
   * The once-per-key driver read cannot cover this: it already ran for a query
   * the session loaded before (hydrates are `once`), so the read is done here.
   * The painted identity includes the replica scope: the same query in another
   * workspace is another persisted row, and `useSync` clears the view when the
   * scope switches.
   */
  #hydrateListQuery = (): void => {
    const params = this.#requestedListParams;
    const storageKey = this.#requestedListStorageKey;
    if (!params || storageKey === undefined) return;

    const paintedKey = `${resourceListResource.scope.get()}\u0000${storageKey}`;
    if (paintedKey === this.#paintedListKey) return;
    this.#paintedListKey = paintedKey;

    void this.#resourceList.hydrate(params, undefined, { overwrite: true });
  };

  /**
   * Fetch orchestration for the explorer list. Hydrates the persisted head page,
   * then revalidates; the rows land in the flat view — read them from the store,
   * never from this hook.
   */
  useFetchResources = (
    params: ResourceQueryParams | null | undefined,
    enable: boolean = true,
  ): ResourceListSyncResult => {
    const normalized = normalizeResourceListParams(params);
    const active = enable && normalized !== null;
    // Subscribed, so the first frame after a hydrate/replace re-renders.
    const hasValue = useFileStore((s) => s.resourceListEntry !== undefined);
    const storageKey = normalized ? resourceListResource.storageKey(normalized) : undefined;
    // Subscribed: a scope switch clears the replica view, so the navigation
    // effect below has to re-run and repaint from the new scope's own row.
    const scope = resourceListResource.scope.use();

    // The latest request, read by the navigation effect below and by the
    // stale-hydrate guard. Kept on the instance so the effect deps stay primitive.
    this.#requestedListParams = normalized ?? undefined;
    this.#requestedListStorageKey = storageKey;

    // Declared before `useSync` so it runs before the sync's own effects: the
    // persisted page of the new pool paints on this frame, not after the fetch.
    useLayoutEffect(() => {
      if (!active || storageKey === undefined) return;
      this.#hydrateListQuery();
    }, [active, scope, storageKey]);

    const sync = this.#resourceList.useSync(active ? normalized : null, { enabled: enable });

    return {
      error: sync.error,
      isHydrated: sync.isHydrated,
      // Nothing painted yet and the network is still to answer: a skeleton, not
      // the "create your first resource" onboarding.
      isLoading: active && !hasValue && !sync.error,
      isValidating: sync.isValidating,
      mutate: sync.revalidate,
      revalidate: sync.revalidate,
    };
  };

  /**
   * Append the next page of the explorer list. The engine reads the loaded head
   * params, dedupes by id and keeps `hasMore` honest.
   */
  loadMoreResources = async (): Promise<void> => {
    await this.#resourceList.loadMore(RESOURCE_LIST_KEY);
  };

  /**
   * Drop the painted page set (e.g. the filter chip changed) while keeping the
   * queried params, so the views render a skeleton and the next query's fetch
   * repaints instead of appending to the previous pool. The persisted rows the
   * engine holds are left alone.
   */
  clearCurrentQueryResources = (): void => {
    // Adopt rows a legacy caller wrote straight into the flat fields first, so
    // the drop below actually clears them.
    this.#ensureListView();
    this.#resourceList.update(RESOURCE_LIST_KEY, () => undefined, { persist: false });
  };

  // ---- create / update / delete ------------------------------------------

  createResource = async (params: CreateResourceParams): Promise<string> => {
    const optimistic = this.#createOptimisticResource(params);
    const showInList = !this.#isResourceOutsideCurrentQuery(optimistic);
    const token = showInList
      ? this.#beginListOptimistic((data) => this.#insertRow(data, optimistic))
      : undefined;

    try {
      const created = (await resourceService.createResource(params)) as ResourceItem;
      this.#commitListOptimistic(token, 'createResource', (data) =>
        this.#settleCreated(data, optimistic.id, created),
      );
    } catch (error) {
      token?.rollback();
      console.error('Failed to create resource:', error);
      throw error;
    }

    return optimistic.id;
  };

  createResourceAndSync = async (params: CreateResourceParams): Promise<string> => {
    const optimistic = this.#createOptimisticResource(params);
    // A row created for another folder (sidebar "+" at the root while a folder
    // is open, a folder row's "+" while the root is open) must not surface in
    // the list the Explorer is currently showing.
    const showInList = !this.#isResourceOutsideCurrentQuery(optimistic);
    const token = showInList
      ? this.#beginListOptimistic((data) => this.#insertRow(data, optimistic))
      : undefined;

    try {
      const created = (await resourceService.createResource(params)) as ResourceItem;
      this.#commitListOptimistic(token, 'createResourceAndSync', (data) =>
        this.#settleCreated(data, optimistic.id, created),
      );
      return created.id;
    } catch (error) {
      token?.rollback();
      throw error;
    }
  };

  deleteResource = async (id: string): Promise<void> => {
    const token = this.#beginListOptimistic((data) => this.#removeRows(data, new Set([id])));

    try {
      await resourceService.deleteResource(id);
      this.#commitListOptimistic(token, 'deleteResource');
    } catch (error) {
      token?.rollback();
      throw error;
    }

    // The file manager's by-id detail replica persists, so a confirmed deletion
    // has to evict it as well: otherwise a direct visit to the deleted id
    // repaints it until a NOT_FOUND answer arrives, and offline it never does.
    this.#get().forgetKnowledgeItems([id]);
  };

  deleteResources = async (ids: string[]) => {
    if (ids.length === 0) return;

    const idsSet = new Set(ids);
    const token = this.#beginListOptimistic((data) => this.#removeRows(data, idsSet));

    try {
      await resourceService.deleteResources(ids);
      this.#commitListOptimistic(token, 'deleteResources');
    } catch (error) {
      token?.rollback();
      throw error;
    }

    // See `deleteResource`: the detail replica persists by id, so it must be
    // evicted here too.
    this.#get().forgetKnowledgeItems(ids);
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

    const token = this.#beginListOptimistic((data) => this.#patchRow(data, id, () => updated));

    try {
      const result = (await resourceService.updateResource(id, updates)) as ResourceItem;
      this.#commitListOptimistic(token, 'updateResource', (data) =>
        this.#patchRow(data, id, () => result),
      );
    } catch (error) {
      token?.rollback();
      throw error;
    }
  };

  moveResource = async (id: string, parentId: string | null): Promise<void> => {
    const { queryParams, resourceMap } = this.#get();
    const existing = resourceMap.get(id);

    if (!existing) {
      console.warn(`Resource ${id} not found for move`);
      return;
    }

    // List rows may omit `parentId`; only a known parent can prove a no-op move.
    if (existing.parentId !== undefined && (existing.parentId ?? null) === parentId) return;

    // Capture what the completed move needs to reconcile the *other* folders'
    // cached lists before the request goes out: the user may switch scope while
    // it is in flight, after which neither the scope nor the old folders' slug
    // aliases can be read from the store any more. A move of a row visible in
    // the Explorer lands here (the tree delegates to this action), so this is
    // the only place those caches get patched.
    const cachePatch = await this.prepareResourceMoveCachePatch(
      [existing.parentId, queryParams?.parentId ?? null],
      parentId,
    );

    const movedOptimistic: ResourceItem = {
      ...existing,
      _optimistic: {
        ...(existing._optimistic || {
          queryKey: getResourceQueryKey(queryParams),
          retryCount: 0,
        }),
        isPending: true,
      },
      parentId,
      updatedAt: new Date(),
    };
    const shouldKeepVisible =
      !queryParams || this.#isResourceVisibleInCurrentQuery(movedOptimistic);

    const applyMove = (data: ResourceListValue, resource: ResourceItem) =>
      shouldKeepVisible
        ? this.#patchRow(data, id, () => resource)
        : this.#removeRows(data, new Set([id]));

    const token = this.#beginListOptimistic((data) => applyMove(data, movedOptimistic));

    let moved: ResourceItem;
    try {
      moved = (await resourceService.moveResource(id, parentId, existing)) as ResourceItem;
      token?.commit((data) => applyMove(data, moved));
    } catch (error) {
      token?.rollback();
      throw error;
    }

    // A row that left the mounted folder shifts the loaded offsets, so the next
    // "load more" would skip the row that moved up into the gap: drop the loaded
    // depth to the head before confirming.
    if (!shouldKeepVisible) this.#resourceList.collapse(RESOURCE_LIST_KEY);

    // The server accepted the move, so a reconciliation failure must not undo it
    // or report the operation as failed (the caller — the tree's optimistic
    // transaction — would restore a row the server already moved).
    await this.applyMovedResourceToCaches(moved, cachePatch);
  };

  /**
   * Everything a completed move needs to reconcile the explorer's other folder
   * lists, gathered *before* the request goes out: the workspace / library the
   * move is issued from, and both folders widened to every key the explorer may
   * query them by. The user may switch scope while the request is in flight,
   * after which neither the scope nor the old folders' slug aliases can be read
   * from the store any more.
   *
   * Callers pass whatever handle they hold for each folder — a drop target
   * id, a URL slug or an empty root.
   */
  prepareResourceMoveCachePatch = async (
    fromParent: ResourceParentKey | undefined | Array<ResourceParentKey | undefined>,
    toParent: ResourceParentKey | undefined | Array<ResourceParentKey | undefined>,
  ) => {
    const scope = {
      libraryId: this.#get().queryParams?.libraryId,
      workspaceId: getActiveWorkspaceId(),
    };
    const [fromParentKeys, toParentKeys] = await Promise.all([
      this.#resolveParentCacheKeys(Array.isArray(fromParent) ? fromParent : [fromParent]),
      this.#resolveParentCacheKeys(Array.isArray(toParent) ? toParent : [toParent]),
    ]);

    return { fromParentKeys, scope, toParentKeys };
  };

  /**
   * Reconcile a completed move into every cached list of the two folders the
   * move touched — not only the mounted one. The patch was captured before the
   * request (scope + both folders widened to every key the explorer may query
   * them by), because the user may switch scope while it is in flight.
   *
   * The mounted list is patched through the in-memory entry; every other cached
   * folder is patched through its persisted row, so an offline navigation
   * hydrates the reconciled page instead of the pre-move one. The moved row is
   * dropped from a source folder and seeded into a destination folder only when
   * that list is an unfiltered folder listing the row certainly belongs to.
   * Reconcile only while the issuing scope is still active: after a workspace or
   * library switch the mounted replica answers another identity / query.
   */
  applyMovedResourceToCaches = async (
    resource: ResourceItem,
    patch: Awaited<ReturnType<ResourceActionImpl['prepareResourceMoveCachePatch']>>,
  ): Promise<void> => {
    if (getActiveWorkspaceId() !== patch.scope.workspaceId) return;
    if ((this.#get().queryParams?.libraryId ?? undefined) !== patch.scope.libraryId) return;

    const moved = stripOptimistic(resource);
    const toKeys = new Set(patch.toParentKeys);
    const fromKeys = new Set(patch.fromParentKeys.filter((key) => !toKeys.has(key)));

    const reconcileFolderList = (data: ResourceListValue): ResourceListValue | undefined => {
      const params = data.queryParams;
      if (!params || (params.libraryId ?? undefined) !== patch.scope.libraryId) return undefined;

      const parentId = params.parentId ?? null;
      if (fromKeys.has(parentId)) return patchSourceList(data, moved.id);
      if (toKeys.has(parentId) && listsMovedRowUnfiltered(params, moved)) {
        return patchDestinationList(data, moved, params);
      }
      return undefined;
    };

    this.#resourceList.update(
      RESOURCE_LIST_KEY,
      (data) => (data ? (reconcileFolderList(data) ?? data) : data),
      { persist: true },
    );
    await this.#resourceList.patchStoredRows((data) => reconcileFolderList(data));

    await this.#revalidateListQuietly('applyMovedResourceToCaches');
  };

  // ---- local-only row edits (upload / optimistic search paths) ------------

  insertLocalResource = (params: CreateResourceParams, id?: string): string => {
    const optimistic = this.#createOptimisticResource(params, id);

    this.#ensureListView();
    this.#resourceList.update(
      RESOURCE_LIST_KEY,
      (data) => (data ? this.#insertRow(data, optimistic) : data),
      { persist: false },
    );

    return optimistic.id;
  };

  removeLocalResource = (id: string): void => {
    this.#resourceList.update(
      RESOURCE_LIST_KEY,
      (data) => (data ? this.#removeRows(data, new Set([id])) : data),
      { persist: false },
    );
  };

  replaceLocalResource = (tempId: string, resource: ResourceItem): void => {
    this.#ensureListView();

    this.#resourceList.update(
      RESOURCE_LIST_KEY,
      (data) => {
        if (!data) return data;

        const hasTemp = data.items.some((item) => item.id === tempId);
        if (hasTemp) return this.#replaceRow(data, tempId, resource);
        if (data.items.some((item) => item.id === resource.id)) {
          return this.#patchRow(data, resource.id, () => resource);
        }
        // Slug-vs-UUID mismatches can hide the temp row; a resource that belongs
        // in the open folder should still surface.
        if (this.#isResourceVisibleInCurrentQuery(resource)) return this.#insertRow(data, resource);
        return data;
      },
      { persist: false },
    );
  };

  patchLocalResource = (
    id: string,
    updates: Partial<ResourceItem>,
    _actionName: string = 'resource/patchLocalResource',
  ): void => {
    this.#resourceList.update(
      RESOURCE_LIST_KEY,
      (data) =>
        data ? this.#patchRow(data, id, (resource) => ({ ...resource, ...updates })) : data,
      { persist: false },
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

    this.#resourceList.update(
      RESOURCE_LIST_KEY,
      (data) => {
        if (!data) return data;

        let changed = false;
        const rows = data.items.map((resource) => {
          const status =
            statusMap.get(resource.id) ?? (resource.fileId && statusMap.get(resource.fileId));
          if (!status) return resource;

          changed = true;
          return {
            ...resource,
            chunkCount: status.chunkCount !== undefined ? status.chunkCount : resource.chunkCount,
            chunkingError:
              status.chunkingError !== undefined ? status.chunkingError : resource.chunkingError,
            chunkingStatus:
              status.chunkingStatus !== undefined ? status.chunkingStatus : resource.chunkingStatus,
            embeddingError:
              status.embeddingError !== undefined ? status.embeddingError : resource.embeddingError,
            embeddingStatus:
              status.embeddingStatus !== undefined
                ? status.embeddingStatus
                : resource.embeddingStatus,
            finishEmbedding:
              status.finishEmbedding !== undefined
                ? status.finishEmbedding
                : resource.finishEmbedding,
          };
        });

        return changed ? { ...data, items: rows } : data;
      },
      { persist: true },
    );
  };

  // ---- knowledge base membership -----------------------------------------

  addResourcesToKnowledgeBase = async (knowledgeBaseId: string, ids: string[]): Promise<void> => {
    if (ids.length === 0) return;

    const idsSet = new Set(ids);
    const token = this.#beginListOptimistic((data) =>
      this.#patchRows(data, idsSet, (resource) => ({
        ...resource,
        _optimistic: {
          ...(resource._optimistic || {
            queryKey: getResourceQueryKey(this.#get().queryParams),
            retryCount: 0,
          }),
          isPending: true,
        },
        knowledgeBaseId,
      })),
    );

    try {
      await knowledgeBaseService.addFilesToKnowledgeBase(knowledgeBaseId, ids);
      this.#commitListOptimistic(token, 'addResourcesToKnowledgeBase', (data) =>
        this.#patchRows(data, idsSet, (resource) =>
          this.#clearSyncingOptimistic({ ...resource, knowledgeBaseId }),
        ),
      );
    } catch (error) {
      token?.rollback();
      throw toError(error);
    }
  };

  removeResourcesFromKnowledgeBase = async (
    knowledgeBaseId: string,
    ids: string[],
  ): Promise<void> => {
    if (ids.length === 0) return;

    const idsSet = new Set(ids);
    const isKnowledgeBaseView = this.#get().queryParams?.libraryId === knowledgeBaseId;
    const token = this.#beginListOptimistic((data) =>
      isKnowledgeBaseView
        ? this.#removeRows(data, idsSet)
        : this.#patchRows(data, idsSet, (resource) => ({
            ...resource,
            _optimistic: {
              ...(resource._optimistic || {
                queryKey: getResourceQueryKey(this.#get().queryParams),
                retryCount: 0,
              }),
              isPending: true,
            },
            knowledgeBaseId: undefined,
          })),
    );

    try {
      await knowledgeBaseService.removeFilesFromKnowledgeBase(knowledgeBaseId, ids);
      if (isKnowledgeBaseView) {
        this.#commitListOptimistic(token, 'removeResourcesFromKnowledgeBase');
        // The rows left the server's page too, so the loaded depth no longer
        // lines up with the survivors. Drop the loaded pages to the head first:
        // the confirmation then repaints a real head page and "load more"
        // restarts from offset 1 instead of skipping the row that shifted up
        // into the gap (a multi-page list kept its old cursor otherwise).
        this.#resourceList.collapse(RESOURCE_LIST_KEY);
        await this.#revalidateListQuietly('removeResourcesFromKnowledgeBase');
      } else {
        this.#commitListOptimistic(token, 'removeResourcesFromKnowledgeBase', (data) =>
          this.#patchRows(data, idsSet, (resource) =>
            this.#clearSyncingOptimistic({ ...resource, knowledgeBaseId: undefined }),
          ),
        );
      }
    } catch (error) {
      token?.rollback();
      throw toError(error);
    }
  };
}

export type ResourceAction = Pick<ResourceActionImpl, keyof ResourceActionImpl>;

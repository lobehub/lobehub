import { useLayoutEffect, useMemo } from 'react';
import { type SWRResponse } from 'swr';

import {
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  type ReplicaLens,
  type ReplicaPagedData,
  type ReplicaPageResult,
  type ReplicaResource,
} from '@/libs/replica';
import { mutate } from '@/libs/swr';
import { type StoreSetter } from '@/store/types';

import { type UserMemoryStore } from '../../store';
import { clearReplicas, clearUserReplicas, memoryListKey } from '../../utils/replica';
import { OffsetListPager } from './offsetListPager';

/** Query of one memory list page set; `pageSize` is not part of its identity. */
export interface MemoryListParams {
  pageSize: number;
  q?: string;
  sort?: string;
}

/** A memory list page set, tagged with the query it answers. */
export interface MemoryListData<TItem, TSort extends string = string> extends ReplicaPagedData<
  TItem,
  number
> {
  q?: string;
  sort?: TSort;
}

/** The `SWRResponse`-shaped result the memory list pages already consume. */
export interface MemoryListPageResult<TItem> {
  items: TItem[];
  page: number;
  pageSize: number;
  total: number;
}

type StoreField = keyof UserMemoryStore & string;

export interface MemoryQueryListOptions<TParams extends MemoryListParams, TItem, TData> {
  /** Devtools prefix of the replica writes. */
  actionPrefix: string;
  /** Store field holding the active query's entry key. */
  activeKeyField: StoreField;
  /** Store field holding every page set by entry key (the replica view). */
  entriesField: StoreField;
  /** One server page; `page` is 1-based. */
  fetchPage: (params: TParams, page: number) => Promise<{ items: TItem[]; total: number }>;
  get: () => UserMemoryStore;
  /**
   * The flat fields existing consumers read, mirrored from the active query's
   * page set (`undefined` = the active query has no view yet).
   */
  mirror: (data: TData | undefined) => Partial<UserMemoryStore>;
  /** Plain UI fields of a newly selected query (search / sort descriptors). */
  queryFields: (params: Omit<TParams, 'pageSize'>) => Partial<UserMemoryStore>;
  /** Store field holding the replica bookkeeping slot. */
  replicaField: StoreField;
  resource: ReplicaResource<TParams, TData, ReplicaPageResult<TItem, number>>;
  /** SWR key root the resource adopts as its sync key (`userMemoryKeys.<list>.root`). */
  rootKey: string;
  set: StoreSetter<UserMemoryStore>;
  /** `useUserMemoryStore`, passed in so this module never imports the store at runtime. */
  useStore: <T>(selector: (state: UserMemoryStore) => T) => T;
}

/**
 * One offset-paged memory list (activities, contexts, experiences,
 * preferences), shared so every list behaves the same:
 *
 * - **One entry per query.** Each search / sort is its own replica entry
 *   (`memoryListKey`), so a query switch keeps the previous query's pages and
 *   persisted row, and every query paints its own cached head on the first
 *   frame. The flat store fields mirror the active query's entry.
 * - **Bounded.** At most `MAX_RECENT_MEMORY_QUERIES` query page sets
 *   survive, in memory and in IndexedDB, across reloads too.
 * - **Delete / load more / purge** go through {@link OffsetListPager}.
 * - **Edits** patch every loaded and persisted query (`linkReplicaEntity`).
 */
export class MemoryQueryList<
  TParams extends MemoryListParams,
  TItem extends { id: string },
  TData extends MemoryListData<TItem>,
> {
  readonly #entity;
  readonly #list;
  readonly #options: MemoryQueryListOptions<TParams, TItem, TData>;
  readonly #pager: OffsetListPager;

  constructor(options: MemoryQueryListOptions<TParams, TItem, TData>) {
    this.#options = options;
    const { activeKeyField, entriesField, get, mirror, replicaField, resource, set } = options;
    const entries = recordLens<UserMemoryStore, TData>(entriesField);
    const isActive = (state: UserMemoryStore, key: string) => state[activeKeyField] === key;

    // The canonical value is one page set per query; the flat fields mirror
    // the active query's entry in the same commit as any write to it.
    const lens: ReplicaLens<UserMemoryStore, TData> = {
      clear: (state) => ({ ...entries.clear(state), ...mirror(undefined) }),
      get: entries.get,
      keys: entries.keys,
      set: (state, key, data) => ({
        ...entries.set(state, key, data),
        ...(isActive(state, key) ? mirror(data) : undefined),
      }),
    };

    this.#list = createReplicaSlice(resource, {
      actionPrefix: options.actionPrefix,
      fetcher: async (params, cursor) => {
        const page = await options.fetchPage(params, (cursor ?? 0) + 1);
        return { items: page.items, total: page.total };
      },
      get,
      set,
      stateKey: replicaField,
      view: lens,
      // Keep each painted page set self-describing (which query it answers).
      viewFields: ({ q, sort }) => ({ q: q || undefined, sort }) as Partial<TData>,
    });
    this.#entity = linkReplicaEntity<TItem>([this.#list]);
    this.#pager = new OffsetListPager({
      keys: () => Object.keys(get()[entriesField] as Record<string, TData>),
      read: (key) => (get()[entriesField] as Record<string, TData>)[key],
      refreshHead: this.#revalidate,
      scope: () => resource.scope.get(),
      slice: this.#list,
    });
  }

  #activeKey = (): string => this.#options.get()[this.#options.activeKeyField] as string;

  /**
   * Revalidate the mounted query. The resource syncs under its legacy SWR key
   * (`rootKey`), which the replica's own `revalidate()` (it matches
   * `replica:sync` keys only) never reaches. The bare matcher form resolves
   * once the refetch settled.
   */
  #revalidate = (): Promise<unknown> =>
    mutate((key) => Array.isArray(key) && key[0] === this.#options.rootKey);

  /**
   * Purge for "delete all memories": every query page set, in memory and in
   * IndexedDB, after any page or delete in flight. Retried once; `false` when a
   * persisted row survived.
   */
  clear = (user?: string): Promise<boolean> =>
    user === undefined || user === this.#options.resource.scope.get()
      ? this.#pager.clear(() => clearReplicas(this.#list.clear))
      : clearUserReplicas(user, this.#list);

  /** Optimistic delete with the offset repair (see `OffsetListPager`). */
  delete = (id: string, serverCall: () => Promise<unknown>): Promise<void> =>
    this.#pager.delete(id, serverCall);

  /** Next page of the active query, once its head is trustworthy. */
  loadMore = (): Promise<void> => this.#pager.loadMore(this.#activeKey());

  /**
   * Fill one query's slot from IndexedDB before the route commits, so a cold
   * visit paints the cached rows instead of the loading skeleton. A later
   * `useSync` hydrate is a no-op once filled.
   */
  preHydrate = (params: TParams): Promise<boolean> => {
    const scope = this.#options.resource.scope.get();
    // The slot may still hold the previous user's rows; drop them before seeding.
    this.#list.ensureScope(scope);
    return this.#list.hydrate(params, scope);
  };

  /**
   * Point the flat mirrors at another query. Each query keeps its own entry,
   * so this never drops a page set: a query loaded before repaints from
   * memory, one persisted before hydrates from storage, and a new one shows the
   * loading state until its head lands. A no-op when the query is unchanged.
   */
  select = (query: Omit<TParams, 'pageSize'>): void => {
    const { activeKeyField, actionPrefix, entriesField, get, mirror, queryFields, set } =
      this.#options;
    const key = memoryListKey(query);
    const state = get();
    if (state[activeKeyField] === key) return;

    const entry = (state[entriesField] as Record<string, TData>)[key];
    set(
      {
        [activeKeyField]: key,
        ...queryFields(query),
        ...mirror(entry),
      } as Partial<UserMemoryStore>,
      false,
      `${actionPrefix}/select`,
    );
  };

  /** Confirmed patch of one row in every loaded query and every persisted one. */
  updateEntity = (id: string, fn: (item: TItem) => TItem): void => {
    this.#entity.update(id, fn);
  };

  /**
   * Fetch orchestration for the list page. Returns an `SWRResponse`-shaped
   * result whose `data` reads the active query's page set, so the list pages
   * (which pass it to `MemoryListBoundary`) keep their shape.
   *
   * - `error` is the head failure of the query on screen, only while it has
   *   nothing painted: a failed background revalidation keeps its rows.
   * - `isLoading` covers a head load with no rows yet and a "load more" in
   *   flight (rows stay mounted under the footer). A failed page is the page
   *   set's `loadMoreError`, rendered by the list footer with a retry.
   */
  useFetch = (params: TParams): SWRResponse<MemoryListPageResult<TItem>> => {
    const { pageSize: _pageSize, ...query } = params;
    const key = memoryListKey(params);

    // Select the query before paint, so a frame never shows another query's rows.
    useLayoutEffect(() => {
      this.select(query as Omit<TParams, 'pageSize'>);
    }, [key]);

    const sync = this.#list.useSync(params, {
      ...this.#pager.syncCallbacks(key),
    });

    const view = this.#options.useStore(
      (state) => (state[this.#options.entriesField] as Record<string, TData>)[key],
    );
    const data = useMemo<MemoryListPageResult<TItem> | undefined>(
      () =>
        view
          ? {
              items: view.items,
              page: view.currentPage + 1,
              pageSize: view.pageSize,
              total: view.total ?? view.items.length,
            }
          : undefined,
      [view],
    );

    return {
      data,
      error: data ? undefined : sync.error,
      isLoading: data ? Boolean(view?.isLoadingMore) : sync.isValidating || !sync.isHydrated,
      isValidating: sync.isValidating,
      mutate: sync.revalidate,
    } as unknown as SWRResponse<MemoryListPageResult<TItem>>;
  };
}

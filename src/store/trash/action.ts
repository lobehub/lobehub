import type { TrashCountByType, TrashItem, TrashProjectFilter } from '@lobechat/types';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import {
  cacheScope,
  createReplicaSlice,
  recordLens,
  type ReplicaPageResult,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { mutate } from '@/libs/swr';
import { trashService, type TrashViewFilter } from '@/services/trash';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import type { TrashListData } from './initialState';
import {
  trashCountResource,
  trashListKey,
  type TrashListParams,
  trashListResource,
} from './projection';
import type { TrashStore } from './store';

const n = setNamespace('trash');

type Setter = StoreSetter<TrashStore>;

/** SWR key roots whose lists can regain rows after a restore. */
const RESTORE_AFFECTED_KEY_PREFIXES = [
  'agent:',
  // Agent sidebar sync keys (#18913) live outside `agent:` so they skip SWR persistence.
  'agentSync:',
  'document:',
  'file:',
  'group:',
  'home:',
  'image:',
  // Replicas (topic list, …) sync through `replica:sync` keys (`@lobechat/replica`).
  'replica:',
  // conversation transcripts — a restored message must reappear in its thread
  'message:',
  'page',
  'project',
  'recent:',
  'resource:',
  'session:',
  'task:',
  'topic:',
  'video:',
];

/**
 * "Empty trash" stopped because the user switched to another scope (account /
 * workspace) while it was running. Every batch already sent ran in the scope
 * the sweep started in; nothing was purged anywhere else.
 */
export class TrashEmptyScopeChangedError extends Error {
  constructor() {
    super('The active scope changed while emptying the trash');
    this.name = 'TrashEmptyScopeChangedError';
  }
}

export const trashSlice = (set: Setter, get: () => TrashStore, _api?: unknown) =>
  new TrashActionImpl(set, get, _api);

/**
 * Recycle-bin store. The list and the per-type counts are local-first replicas:
 * each filter keeps its own persisted page (first frame paints from storage,
 * the network confirms), and a restore / purge drops the row from every loaded
 * filter before the counts revalidate.
 */
export class TrashActionImpl {
  readonly #get: () => TrashStore;
  readonly #set: Setter;
  readonly #trashCount;
  readonly #trashList;

  constructor(set: Setter, get: () => TrashStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#trashList = createReplicaSlice(trashListResource, {
      actionPrefix: n('trashList'),
      fetcher: this.#fetchPage,
      get,
      set,
      stateKey: 'trashListReplica',
      view: recordLens<TrashStore, TrashListData>('trashListMap'),
    });
    this.#trashCount = createReplicaSlice(trashCountResource, {
      actionPrefix: n('trashCount'),
      fetcher: ({ projectId }) => trashService.countByType(projectId),
      get,
      set,
      stateKey: 'trashCountReplica',
      view: recordLens<TrashStore, TrashCountByType>('trashCountMap'),
    });
  }

  /** One recycle-bin page: `cursor` undefined = the head (newest first). */
  #fetchPage = async (
    { projectId, resourceType }: TrashListParams,
    cursor?: string,
  ): Promise<ReplicaPageResult<TrashItem, string>> => {
    const { items, nextCursor } = await trashService.list(
      cursor ? { cursor, projectId, resourceType } : { projectId, resourceType },
    );
    return { items, nextCursor };
  };

  /**
   * Switch the view. Each view is its own keyed entry, so a late response for
   * the previous one lands in that entry and never repaints this one; the
   * entry switched to starts again from its head page instead of the pages
   * loaded on an earlier visit. `scope` binds the project to the scope it was
   * chosen in (see `trashSelectors.activeProjectId`).
   */
  setFilter = ({ projectId, resourceType }: TrashViewFilter, scope: string) => {
    this.#set(
      { activeType: resourceType, projectSelection: { projectId, scope } },
      false,
      n('setFilter'),
    );
    this.#trashList.collapse(trashListKey({ projectId, resourceType }));
  };

  /** Re-fetch the list(s) and the counts of the active identity. */
  refresh = async () => {
    await Promise.all([this.#trashList.revalidate(), this.#trashCount.revalidate()]);
  };

  /**
   * A restore brings rows back into lists owned by other stores (sidebar
   * agents, topics, pages, files, tasks …). Revalidate every mounted SWR key in
   * those namespaces so a user returning from the recycle bin sees the row
   * without a reload. `mutate` with a filter only re-fetches keys that have a
   * mounted subscriber, so this is cheap.
   */
  revalidateRestoredScopes = async () => {
    await mutate(
      (key: unknown) =>
        Array.isArray(key) &&
        typeof key[0] === 'string' &&
        RESTORE_AFFECTED_KEY_PREFIXES.some((prefix) => (key[0] as string).startsWith(prefix)),
    );
  };

  /** Next page of one view, using its loaded head page's params. */
  loadMore = async (filter: TrashViewFilter) => {
    await this.#trashList.loadMore(trashListKey(filter), filter);
  };

  /** Drop a row from every loaded filter (the engine also patches persisted rows). */
  #dropRows = (ids: Iterable<string>) => {
    for (const id of ids) this.#trashList.updateEntity(id, () => undefined);
  };

  #withLoading = async (ids: string[], run: () => Promise<void>) => {
    this.#set({ loadingIds: [...this.#get().loadingIds, ...ids] }, false, n('loading/start'));
    try {
      await run();
    } finally {
      const done = new Set(ids);
      this.#set(
        { loadingIds: this.#get().loadingIds.filter((id) => !done.has(id)) },
        false,
        n('loading/end'),
      );
      await this.refresh();
    }
  };

  /**
   * Restore roots. Returns the server outcome so the caller can toast the
   * partial failures (a topic whose agent is still in the bin, …). Only the
   * successfully restored rows leave the list.
   */
  restore = async (ids: string[]) => {
    let outcome: Awaited<ReturnType<typeof trashService.restore>> = { failed: [], restored: [] };
    await this.#withLoading(ids, async () => {
      outcome = await trashService.restore(ids);
      const gone = new Set(outcome.restored.map((item) => item.id));
      // `notFound` rows were dropped from the registry server-side.
      for (const failure of outcome.failed) if (failure.code === 'notFound') gone.add(failure.id);
      this.#dropRows(gone);
    });
    if (outcome.restored.length > 0) void this.revalidateRestoredScopes();
    return outcome;
  };

  purge = async (ids: string[]) => {
    await this.#withLoading(ids, async () => {
      await trashService.purge(ids);
      this.#dropRows(ids);
    });
  };

  /**
   * Purge every root `filter` covers, across all pages, in the scope the call
   * starts in. The filter and scope are fixed for the whole sweep: switching
   * the view (or the workspace) while batches run never widens what is
   * purged — a scope switch stops the sweep with `TrashEmptyScopeChangedError`.
   */
  emptyTrash = async (filter: TrashViewFilter) => {
    const scope = cacheScope.get();
    const workspaceId = getActiveWorkspaceId();
    const key = trashListKey(filter);
    const ids = this.#get().trashListMap[key]?.items.map((item) => item.id) ?? [];
    await this.#withLoading(ids, async () => {
      // The server purges one bounded batch per call so no single request runs
      // away on a large bin; keep going until it reports nothing left.
      for (;;) {
        if (cacheScope.get() !== scope) throw new TrashEmptyScopeChangedError();
        const { hasMore } = await trashService.emptyTrash(filter, workspaceId);
        if (!hasMore) break;
      }
      // The view lives in the scope the sweep ran in; do not touch another's.
      if (cacheScope.get() !== scope) return;
      // Its rows are gone from every other loaded view too (the same root can
      // sit under "All", its type and its project).
      this.#dropRows(ids);
      // The view is swept server-side across every page, so it collapses to an
      // empty head page rather than dropping only loaded rows.
      this.#trashList.update(key, (data) =>
        data
          ? {
              ...data,
              currentPage: 0,
              hasMore: false,
              items: [],
              nextCursor: null,
              pages: [{ count: 0, next: null }],
              total: 0,
            }
          : data,
      );
    });
  };

  /**
   * Fetch orchestration for one view's recycle-bin page. Hydrates the
   * persisted projection, then revalidates; rows land in `trashListMap` — read
   * them through `trashSelectors`, never from this hook.
   */
  useFetchTrash = (enabled: boolean, filter: TrashViewFilter): ReplicaSyncResult =>
    this.#trashList.useSync(enabled ? filter : null);

  /** Fetch orchestration for one project filter's per-type counts; read them via `trashSelectors`. */
  useFetchTrashCount = (enabled: boolean, projectId?: TrashProjectFilter): ReplicaSyncResult =>
    this.#trashCount.useSync(enabled ? { projectId } : null);
}

export type TrashAction = Pick<TrashActionImpl, keyof TrashActionImpl>;
export type { TrashItem };

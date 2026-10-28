import {
  type AddFavoriteParams,
  type FavoriteItem,
  type FavoriteType,
  toFavoriteTitle,
} from '@lobechat/types';

import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { favoriteService } from '@/services/favorite';
import type { HomeStore } from '@/store/home/store';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { FAVORITE_LIST_KEY, favoriteListResource } from './projection';
import { favoriteSelectors } from './selectors';

const n = setNamespace('favorite');

const LIST_PARAMS = {} as Record<string, never>;

type FavoriteSnapshot = Partial<Pick<FavoriteItem, 'icon' | 'path' | 'title'>>;

/** Rows added on the client before the server confirmed them. */
export const isOptimisticId = (id: string) => id.startsWith('optimistic:');

/**
 * The row an id from the list points at. A client id names its target, so it
 * still finds the row after the server confirmed it under a real id.
 */
const findRow = (items: FavoriteItem[], id: string): FavoriteItem | undefined => {
  const byId = items.find((item) => item.id === id);
  if (byId || !isOptimisticId(id)) return byId;
  const [, type, ...rest] = id.split(':');
  const targetId = rest.join(':');
  return items.find((item) => item.type === type && item.targetId === targetId);
};

const isTarget = (item: FavoriteItem, type: FavoriteType, targetId: string) =>
  item.type === type && item.targetId === targetId;

/** Insert or refresh `item` in place, the way the server upserts by target. */
const upsert = (items: FavoriteItem[], item: FavoriteItem): FavoriteItem[] => {
  const index = items.findIndex((row) => isTarget(row, item.type, item.targetId));
  if (index === -1) return [...items, item];
  const next = [...items];
  next[index] = { ...item, id: items[index].id };
  return next;
};

const RETRY_DELAYS_MS = [1000, 3000];

/** Run a background write, retrying after each delay before giving up. */
const withRetry = async (run: () => Promise<void>): Promise<void> => {
  for (const delay of [...RETRY_DELAYS_MS, undefined]) {
    try {
      return await run();
    } catch (error) {
      if (delay === undefined) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
};

/** The snapshot fields that differ from the saved row, or undefined when none do. */
const snapshotChanges = (
  item: FavoriteItem,
  snapshot: FavoriteSnapshot,
): FavoriteSnapshot | undefined => {
  const changes = Object.fromEntries(
    Object.entries(snapshot).filter(
      ([key, value]) => value !== undefined && item[key as keyof FavoriteSnapshot] !== value,
    ),
  ) as FavoriteSnapshot;
  return Object.keys(changes).length > 0 ? changes : undefined;
};

type Setter = StoreSetter<HomeStore>;
export const createFavoriteSlice = (set: Setter, get: () => HomeStore, _api?: unknown) =>
  new FavoriteActionImpl(set, get, _api);

export class FavoriteActionImpl {
  readonly #get: () => HomeStore;
  readonly #list;
  /** Writes per target reach the server in order, so a quick re-toggle cannot land reversed. */
  readonly #targetQueues = new Map<string, Promise<unknown>>();
  /** Reorders reach the server in drag order, so the last drag wins. */
  #reorderQueue: Promise<unknown> = Promise.resolve();
  /** Adds still waiting for the server; a reorder waits for them to learn their ids. */
  readonly #pendingAdds = new Set<Promise<unknown>>();

  constructor(set: Setter, get: () => HomeStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#list = createReplicaSlice(favoriteListResource, {
      actionPrefix: n('favoriteList'),
      fetcher: () => favoriteService.list(),
      get,
      set,
      stateKey: 'favoriteListReplica',
      view: recordLens<HomeStore, FavoriteItem[]>('favoriteListMap'),
    });
  }

  #enqueue = async <T>(type: FavoriteType, targetId: string, run: () => Promise<T>) => {
    const key = `${type}:${targetId}`;
    const previous = this.#targetQueues.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(run);
    this.#targetQueues.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.#targetQueues.get(key) === operation) this.#targetQueues.delete(key);
    }
  };

  addFavorite = async (input: AddFavoriteParams): Promise<void> => {
    // The server stores the cut title; keep the optimistic row and later
    // snapshot comparisons on the same value.
    const params = { ...input, title: toFavoriteTitle(input.title) };
    const optimisticItem: FavoriteItem = {
      icon: params.icon ?? null,
      id: `optimistic:${params.type}:${params.targetId}`,
      path: params.path,
      targetId: params.targetId,
      title: params.title,
      type: params.type,
    };

    const operation = this.#list.optimistic(
      FAVORITE_LIST_KEY,
      (items = []) => upsert(items, optimisticItem),
      () => this.#enqueue(params.type, params.targetId, () => favoriteService.add(params)),
      {
        confirm:
          (saved) =>
          (items = []) => {
            const index = items.findIndex((row) => isTarget(row, saved.type, saved.targetId));
            if (index === -1) return [...items, saved];
            const next = [...items];
            next[index] = saved;
            return next;
          },
      },
    );
    // Settles once the confirmed row (with its real id) is in the list.
    this.#pendingAdds.add(operation);
    try {
      await operation;
    } finally {
      this.#pendingAdds.delete(operation);
    }
  };

  refreshFavorites = async (): Promise<void> => {
    await this.#list.revalidate();
  };

  removeFavorite = async (type: FavoriteType, targetId: string): Promise<void> => {
    await this.#list.optimistic(
      FAVORITE_LIST_KEY,
      (items = []) => items.filter((item) => !isTarget(item, type, targetId)),
      () => this.#enqueue(type, targetId, () => favoriteService.removeByTarget(type, targetId)),
    );
  };

  reorderFavorites = async (ids: string[]): Promise<void> => {
    await this.#list.optimistic(
      FAVORITE_LIST_KEY,
      (items = []) => {
        const listed = ids.flatMap((id) => findRow(items, id) ?? []);
        const rest = items.filter((item) => !listed.includes(item));
        return [...listed, ...rest];
      },
      () => {
        const operation = this.#reorderQueue
          .catch(() => undefined)
          .then(async () => {
            // A row being added has no server id yet: wait for its add, then
            // send the whole order with real ids so the server keeps its slot.
            await Promise.allSettled(this.#pendingAdds);
            const items = favoriteSelectors.favorites(this.#get());
            const persistedIds = ids
              .map((id) => findRow(items, id)?.id)
              .filter((id): id is string => !!id && !isOptimisticId(id));
            await favoriteService.reorder(persistedIds);
          });
        this.#reorderQueue = operation;
        return operation;
      },
    );
  };

  toggleFavorite = async (params: AddFavoriteParams): Promise<void> => {
    const isFavorite = favoriteSelectors.isFavorite(params.type, params.targetId)(this.#get());
    if (isFavorite) await this.removeFavorite(params.type, params.targetId);
    else await this.addFavorite(params);
  };

  /**
   * Keep the snapshot of a favorite in step with the page it points at (a
   * renamed topic, a new page emoji). A no-op when nothing changed or the
   * target is not a favorite. Before the list has loaded in this session (a
   * project renamed from its own settings, with the home sidebar never shown)
   * the row is looked up on the server, so the saved title still follows.
   */
  syncFavoriteSnapshot = async (
    type: FavoriteType,
    targetId: string,
    input: FavoriteSnapshot,
  ): Promise<void> => {
    const snapshot =
      input.title === undefined ? input : { ...input, title: toFavoriteTitle(input.title) };

    if (favoriteSelectors.favoriteList(this.#get()) === undefined) {
      // Nothing mounted here retries a missed write, so ride out a brief outage.
      await withRetry(async () => {
        const remote = (await favoriteService.list()).find((row) => isTarget(row, type, targetId));
        const changes = remote && snapshotChanges(remote, snapshot);
        if (remote && changes) await favoriteService.update(remote.id, changes);
      });
      return;
    }

    const item = favoriteSelectors.getFavorite(type, targetId)(this.#get());
    if (!item || isOptimisticId(item.id)) return;

    const changes = snapshotChanges(item, snapshot);
    if (!changes) return;

    await this.#list.optimistic(
      FAVORITE_LIST_KEY,
      (items = []) => items.map((row) => (row.id === item.id ? { ...row, ...changes } : row)),
      () => this.#enqueue(type, targetId, () => favoriteService.update(item.id, changes)),
    );
  };

  useFetchFavorites = (enabled: boolean): ReplicaSyncResult =>
    this.#list.useSync(LIST_PARAMS, { enabled });
}

export type FavoriteAction = Pick<FavoriteActionImpl, keyof FavoriteActionImpl>;

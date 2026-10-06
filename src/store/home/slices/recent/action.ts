import type { RecentItem } from '@lobechat/types';

import {
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  type ReplicaEntityAdapter,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { documentService } from '@/services/document';
import { RECENT_SIDEBAR_TYPES, recentService } from '@/services/recent';
import { taskService } from '@/services/task';
import { topicService } from '@/services/topic';
import type { HomeStore } from '@/store/home/store';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type RecentEntityRef, toRecentEntityRef } from './initialState';
import { recentListResource } from './projection';

const n = setNamespace('recent');

/** Rows in the "all recents" drawer. */
export const ALL_RECENTS_LIMIT = 50;

interface RenameRecentParams {
  id: string;
  title: string;
  type: RecentItem['type'];
}

/** Recents mix entity types, so rows are addressed by `${type}:${id}`. */
const recentEntity: ReplicaEntityAdapter<RecentItem[], RecentItem> = {
  has: (items, ref) => items.some((item) => toRecentEntityRef(item) === ref),
  map: (items, ref, fn) => {
    let changed = false;
    const next: RecentItem[] = [];
    for (const item of items) {
      if (toRecentEntityRef(item) !== ref) {
        next.push(item);
        continue;
      }
      const mapped = fn(item);
      if (mapped !== item) changed = true;
      if (mapped) next.push(mapped);
    }
    return changed ? next : items;
  },
};

const withTitle = (item: RecentItem, title: string): RecentItem =>
  // A task rename carries the slug source with it, so the row's link is built
  // from the name the user just typed rather than the one the server still has.
  item.type === 'task' ? { ...item, slugTitle: title, title } : { ...item, title };

type Setter = StoreSetter<HomeStore>;
export const createRecentSlice = (set: Setter, get: () => HomeStore, _api?: unknown) =>
  new RecentActionImpl(set, get, _api);

export class RecentActionImpl {
  readonly #set: Setter;
  /** Server writes per entity run in order; the newest optimistic title stays on top. */
  readonly #renameQueues = new Map<RecentEntityRef, Promise<unknown>>();
  readonly #recentList;
  readonly #recents;

  constructor(set: Setter, get: () => HomeStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#recentList = createReplicaSlice(recentListResource, {
      actionPrefix: n('recentList'),
      entity: recentEntity,
      fetcher: ({ limit }) => recentService.getAll(limit, RECENT_SIDEBAR_TYPES),
      get,
      set,
      stateKey: 'recentListReplica',
      view: recordLens<HomeStore, RecentItem[]>('recentListMap'),
    });
    this.#recents = linkReplicaEntity<RecentItem>([this.#recentList]);
  }

  closeAllRecentsDrawer = (): void => {
    this.#set({ allRecentsDrawerOpen: false }, false, n('closeAllRecentsDrawer'));
  };

  openAllRecentsDrawer = (): void => {
    this.#set({ allRecentsDrawerOpen: true }, false, n('openAllRecentsDrawer'));
  };

  #persistRecentTitle = async ({ id, title, type }: RenameRecentParams): Promise<void> => {
    switch (type) {
      case 'document': {
        await documentService.updateDocument({ id, title });
        break;
      }
      case 'task': {
        await taskService.update(id, { name: title });
        break;
      }
      case 'topic': {
        await topicService.updateTopic(id, { title });
        break;
      }
    }
  };

  /** Revalidate every recents query of the active identity. */
  refreshRecents = async (): Promise<void> => {
    await this.#recentList.revalidate();
  };

  /**
   * Show the new title in every loaded recents query right away, write it to
   * the owning entity, and roll back on failure. Renames of one entity reach
   * the server in order.
   */
  renameRecent = async (params: RenameRecentParams): Promise<void> => {
    const ref = toRecentEntityRef(params);
    const previous = this.#renameQueues.get(ref) ?? Promise.resolve();
    const operation = this.#recents.optimistic(
      ref,
      (item) => withTitle(item, params.title),
      () => previous.catch(() => undefined).then(() => this.#persistRecentTitle(params)),
    );
    this.#renameQueues.set(ref, operation);
    try {
      await operation;
    } finally {
      if (this.#renameQueues.get(ref) === operation) this.#renameQueues.delete(ref);
    }
  };

  /** "All recents" drawer. Read the rows with `homeRecentSelectors.query`. */
  useFetchAllRecents = (open: boolean): ReplicaSyncResult =>
    this.#recentList.useSync({ limit: ALL_RECENTS_LIMIT }, { enabled: open });

  /**
   * Sidebar recents. Asks for `limit + 1` rows to know whether "view all" is
   * needed; read them with `homeRecentSelectors.query`.
   */
  useFetchRecents = (isLogin: boolean | undefined, limit: number = 10): ReplicaSyncResult =>
    this.#recentList.useSync({ limit: limit + 1 }, { enabled: isLogin === true });
}

export type RecentAction = Pick<RecentActionImpl, keyof RecentActionImpl>;

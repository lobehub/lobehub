import type { RecentItem } from '@lobechat/types';

import {
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  type ReplicaEntityAdapter,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { documentService } from '@/services/document';
import { fileService } from '@/services/file';
import { RECENT_CONVERSATION_TYPES, RECENT_SIDEBAR_TYPES, recentService } from '@/services/recent';
import { taskService } from '@/services/task';
import { topicService } from '@/services/topic';
import type { HomeStore } from '@/store/home/store';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type RecentEntityRef, toRecentEntityRef } from './initialState';
import {
  conversationRecentResource,
  DOCS_HOME_LIMIT,
  docsHomeListResource,
  type DocsHomeRow,
  type DocsHomeTab,
  type RecentListParams,
  recentListResource,
  toDocsHomeRow,
} from './projection';

const n = setNamespace('recent');

/** Rows in the "all recents" drawer. */
export const ALL_RECENTS_LIMIT = 50;

/** Topics the Home chat-mode recents block fetches (the customize slider's max). */
export const HOME_TOPIC_RECENT_LIMIT = 15;

/** Rows the desktop tray menu fetches. */
export const TRAY_RECENT_LIMIT = 10;

/** The Home chat-mode recents block: the viewer's own topics, with previews. */
export const HOME_TOPIC_RECENTS_PARAMS = {
  limit: HOME_TOPIC_RECENT_LIMIT,
  types: 'topic',
  view: 'mine',
} as const satisfies RecentListParams;

/** The tray menu: the viewer's own recents of every type. */
export const TRAY_RECENTS_PARAMS = {
  limit: TRAY_RECENT_LIMIT,
  types: 'all',
  view: 'mine',
} as const satisfies RecentListParams;

/**
 * Several surfaces mount the same query (Home, the tray hook, the sidebar), so
 * identical mount requests within this window collapse into one. Manual,
 * post-write and active-topic refreshes still go through `revalidate`.
 */
const RECENT_SYNC_DEDUPE_MS = 10_000;

const fetchRecentList = ({ limit, types = 'sidebar', view }: RecentListParams) => {
  const mineOnly = view === undefined ? undefined : view === 'mine';
  const sharedOnly = view === undefined ? undefined : view === 'team';
  switch (types) {
    case 'all': {
      return recentService.getAll(limit, undefined, false, mineOnly, sharedOnly);
    }
    case 'topic': {
      return recentService.getAll(limit, ['topic'], true, mineOnly, sharedOnly);
    }
    default: {
      return view
        ? recentService.getAll(limit, RECENT_SIDEBAR_TYPES, undefined, mineOnly, sharedOnly)
        : recentService.getAll(limit, RECENT_SIDEBAR_TYPES);
    }
  }
};

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
  readonly #conversationRecents;
  readonly #docsHome;
  readonly #recentList;
  readonly #recents;

  constructor(set: Setter, get: () => HomeStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#recentList = createReplicaSlice(recentListResource, {
      actionPrefix: n('recentList'),
      entity: recentEntity,
      fetcher: fetchRecentList,
      get,
      set,
      stateKey: 'recentListReplica',
      view: recordLens<HomeStore, RecentItem[]>('recentListMap'),
    });
    this.#conversationRecents = createReplicaSlice(conversationRecentResource, {
      actionPrefix: n('conversationRecents'),
      entity: recentEntity,
      // Topics only, with previews: the IM list shows the latest reply per row.
      fetcher: ({ limit }) => recentService.getAll(limit, RECENT_CONVERSATION_TYPES, true),
      get,
      set,
      stateKey: 'conversationRecentReplica',
      view: recordLens<HomeStore, RecentItem[]>('conversationRecentMap'),
    });
    this.#recents = linkReplicaEntity<RecentItem>([this.#recentList, this.#conversationRecents]);
    this.#docsHome = createReplicaSlice(docsHomeListResource, {
      actionPrefix: n('docsHome'),
      fetcher: async ({ tab }) =>
        (await fileService.getDocsHomeItems(tab, DOCS_HOME_LIMIT)).map(toDocsHomeRow),
      get,
      set,
      stateKey: 'docsHomeReplica',
      view: recordLens<HomeStore, DocsHomeRow[]>('docsHomeMap'),
    });
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
    await Promise.all([this.#recentList.revalidate(), this.#conversationRecents.revalidate()]);
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
   * Latest topic per owner for the IM conversation list. Read the rows with
   * `homeRecentSelectors.conversationRecents`.
   */
  useFetchConversationRecents = (limit: number = ALL_RECENTS_LIMIT): ReplicaSyncResult =>
    this.#conversationRecents.useSync({ limit }, { enabled: true });

  /**
   * Home chat-mode recent topics (the viewer's own, server-narrowed). Read them
   * with `homeRecentSelectors.query(createRecentQueryKey(...HOME_TOPIC_RECENTS_PARAMS))`.
   */
  useFetchHomeTopicRecents = (enabled: boolean): ReplicaSyncResult =>
    this.#recentList.useSync(HOME_TOPIC_RECENTS_PARAMS, {
      dedupingInterval: RECENT_SYNC_DEDUPE_MS,
      enabled,
      revalidateOnFocus: false,
    });

  /** Desktop tray recents; `revalidate` refetches them when active topics change. */
  useFetchTrayRecents = (enabled: boolean): ReplicaSyncResult =>
    this.#recentList.useSync(TRAY_RECENTS_PARAMS, {
      dedupingInterval: RECENT_SYNC_DEDUPE_MS,
      enabled,
    });

  /** Refetch every loaded Docs home tab, e.g. after a page or file was added. */
  refreshDocsHome = async (): Promise<void> => {
    await this.#docsHome.revalidate();
  };

  /** The Docs home list for one tab. Read it with `homeRecentSelectors.docsHome`. */
  useFetchDocsHome = (tab: DocsHomeTab, enabled: boolean = true): ReplicaSyncResult =>
    this.#docsHome.useSync({ tab }, { enabled });

  /**
   * Sidebar recents. Asks for `limit + 1` rows to know whether "view all" is
   * needed; read them with `homeRecentSelectors.query`.
   */
  useFetchRecents = (isLogin: boolean | undefined, limit: number = 10): ReplicaSyncResult =>
    this.#recentList.useSync({ limit: limit + 1 }, { enabled: isLogin === true });
}

export type RecentAction = Pick<RecentActionImpl, keyof RecentActionImpl>;

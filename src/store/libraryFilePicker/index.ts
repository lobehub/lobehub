import type { StoreApi } from 'zustand';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn, type UseBoundStoreWithEqualityFn } from 'zustand/traditional';

import {
  cacheScope,
  createReplicaSlice,
  createReplicaState,
  definePagedReplica,
  recordLens,
  type ReplicaPagedData,
  type ReplicaPageResult,
  type ReplicaState,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { resourceService } from '@/services/resource';
import type { ResourceItem } from '@/types/resource';

/** The picker lists one query (every library file), so the replica keeps a single entry. */
export const LIBRARY_FILE_PICKER_KEY = 'default';

export const LIBRARY_FILE_PICKER_PAGE_SIZE = 50;

/** How many loaded pages survive a reload (`paging.persist.pages`). */
export const LIBRARY_FILE_PICKER_PERSISTED_PAGES = 5;

export type LibraryFilePickerValue = ReplicaPagedData<ResourceItem, number>;

/**
 * Files the library file picker offers (`resourceService.queryResources`, with
 * knowledge-base files). A paged replica of its own rather than the explorer's
 * `resourceList`: that one keeps a single entry for whatever folder the
 * explorer shows, so the picker sharing it would repaint the explorer behind
 * the modal with the picker's query. Up to
 * {@link LIBRARY_FILE_PICKER_PERSISTED_PAGES} loaded pages are persisted
 * (IndexedDB, user / workspace scope), so a reopened picker paints the last
 * files at once.
 */
export const libraryFilePickerResource = definePagedReplica<string, ResourceItem, number>({
  key: (key) => key,
  name: 'libraryFilePicker',
  paging: {
    direction: 'forward',
    getId: (item) => item.id,
    mode: 'offset',
    // Folders and pages share the list with files, so the first attachable
    // file can sit pages deep: keep the pages the picker paged through to
    // reach it (no content previews, so a page stays small).
    persist: { pages: LIBRARY_FILE_PICKER_PERSISTED_PAGES },
  },
  storage: 'indexedDB',
  version: 1,
});

/** One page of the picker list; `cursor` is the page index (0 = head). */
const fetchLibraryFilePage = async (
  _key: string,
  cursor?: number,
): Promise<ReplicaPageResult<ResourceItem, number>> => {
  const page = cursor ?? 0;
  const response = await resourceService.queryResources({
    limit: LIBRARY_FILE_PICKER_PAGE_SIZE,
    offset: page * LIBRARY_FILE_PICKER_PAGE_SIZE,
    showFilesInKnowledgeBase: true,
  });

  return {
    items: response.items,
    // Folders and pages are dropped on the client, and the server may filter
    // rows after paging, so only its own `hasMore` ends the list.
    nextCursor: response.hasMore ? page + 1 : null,
    total: response.total,
  };
};

export interface LibraryFilePickerStoreState {
  /**
   * Cache scope the server last answered the list under in this session. A
   * restored head page is a snapshot until then; another scope never vouches
   * for the active one.
   */
  confirmedScope?: string;
  /**
   * Rows on screen when the restored pages behind the head were dropped, with
   * the scope they belong to. The picker keeps showing them (not attachable)
   * while it pages back through fresh pages, instead of flashing a skeleton.
   */
  droppedSnapshot?: { items: ResourceItem[]; scope: string };
  pickerMap: Record<string, LibraryFilePickerValue>;
  pickerReplica: ReplicaState<LibraryFilePickerValue>;
}

export interface LibraryFilePickerSyncResult extends ReplicaSyncResult {
  /**
   * The server has answered for the active identity. A restored head page is a
   * snapshot: until then an empty one is "loading", never "no files".
   */
  isConfirmed: boolean;
  /** Rows shown before the restored pages were dropped (this identity only). */
  snapshotItems?: ResourceItem[];
}

interface LibraryFilePickerStore extends LibraryFilePickerStoreState {
  /** Append the next page. */
  loadMoreFiles: () => Promise<void>;
  /** Fetch orchestration only; read the files with `useLibraryFilePickerList`. */
  useFetchFiles: () => LibraryFilePickerSyncResult;
}

export const initialLibraryFilePickerState: LibraryFilePickerStoreState = {
  confirmedScope: undefined,
  droppedSnapshot: undefined,
  pickerMap: {},
  pickerReplica: createReplicaState(),
};

export const useLibraryFilePickerStore: UseBoundStoreWithEqualityFn<
  StoreApi<LibraryFilePickerStore>
> = createWithEqualityFn<LibraryFilePickerStore>()((set, get) => {
  const files = createReplicaSlice(libraryFilePickerResource, {
    actionPrefix: 'libraryFilePicker/files',
    effects: {
      onApplied: (_data, _params, { key, scope }) => {
        // The first answer of this identity re-lists only the head: pages
        // restored behind it are an unconfirmed snapshot (a file there may be
        // gone), so drop them and let the picker page through fresh ones.
        // Later head refreshes keep the pages this session loaded itself.
        if (get().confirmedScope !== scope) {
          const items = get().pickerMap[key]?.items ?? [];
          if (files.collapse(key)) set({ droppedSnapshot: { items, scope } });
        }
        set({ confirmedScope: scope });
      },
    },
    fetcher: fetchLibraryFilePage,
    get,
    set,
    stateKey: 'pickerReplica',
    view: recordLens<LibraryFilePickerStore, LibraryFilePickerValue>('pickerMap'),
  });

  return {
    ...initialLibraryFilePickerState,
    loadMoreFiles: () => files.loadMore(LIBRARY_FILE_PICKER_KEY, LIBRARY_FILE_PICKER_KEY),
    useFetchFiles: () => {
      const sync = files.useSync(LIBRARY_FILE_PICKER_KEY);
      const scope = cacheScope.use();
      const isConfirmed = useLibraryFilePickerStore((state) => state.confirmedScope === scope);
      const snapshotItems = useLibraryFilePickerStore((state) =>
        state.droppedSnapshot?.scope === scope ? state.droppedSnapshot.items : undefined,
      );
      return { ...sync, isConfirmed, snapshotItems };
    },
  };
}, shallow);

/** The picker list, or `undefined` while neither persisted nor fetched. */
export const useLibraryFilePickerList = () =>
  useLibraryFilePickerStore((state) => state.pickerMap[LIBRARY_FILE_PICKER_KEY]);

import type { ReplicaState } from '@/libs/replica';
import type { StoreHandle } from '@/store/utils/optimisticEngine';

import type { LibraryTreeSnapshot } from './projection';

export interface TreeItem {
  /**
   * Row creation time, so the sidebar can order a folder newest-first like the
   * explorer's default sort does. Optional because optimistic stubs and older
   * cached payloads carry no timestamp; those fall back to A-Z.
   */
  createdAt?: Date | string;
  /**
   * Underlying `files.id` for file nodes. The unified resource list addresses
   * a file that backs a derived page by the page id, so file-table lookups
   * (e.g. the messenger push) must go through this instead of `id`.
   */
  fileId?: string | null;
  fileType: string;
  id: string;
  isFolder: boolean;
  metadata?: Record<string, any>;
  name: string;
  /**
   * Parent folder id when the source row knows it (optimistic creates, rows the
   * server returns with a parent). Lets `reconcile` drop a row the Explorer is
   * holding for another folder; `undefined` means unknown and is kept.
   */
  parentId?: string | null;
  /** Byte size for file nodes — drives the push modal's oversize pre-warning. */
  size?: number;
  slug?: string | null;
  sourceType?: string;
  url: string;
  userId?: string | null;
  visibility?: 'private' | 'public' | null;
}

export interface TreeDataState {
  children: Record<string, TreeItem[]>;
  status: Record<string, 'idle' | 'loading' | 'revalidating' | 'error'>;
}

export type TreeStoreHandle = StoreHandle<TreeDataState>;

export interface TreeState extends TreeDataState {
  /**
   * Forget rows another store already deleted and refresh the folders that
   * held them, falling back to `fallbackParentKey` for rows the tree never
   * loaded. Local bookkeeping only — the caller owns the delete request.
   */
  dropNodes: (itemIds: string[], fallbackParentKey?: string) => Promise<void>;
  epoch: number;
  /** Last load error per folderId, so a failed fetch renders a failure state (with Retry) instead of a false "empty folder". */
  errors: Record<string, unknown>;
  expandAncestors: (folderIds: string[]) => Promise<void>;
  expanded: Record<string, boolean>;
  /** Drop the open library's persisted tree (a server-side bulk delete, see `forgetSnapshot`). */
  forgetLibrary: (knowledgeBaseId: string) => void;
  forgetSnapshot: () => void;

  // actions
  init: (knowledgeBaseId: string) => void;
  knowledgeBaseId: string | null;
  loadChildren: (folderId: string) => Promise<void>;
  moveItem: (itemId: string, fromParent: string, toParent: string) => Promise<void>;
  moveItems: (itemIds: string[], fromParent: string, toParent: string) => Promise<void>;
  /**
   * Read the library's persisted tree into `snapshotMap` so the next `init`
   * paints it on its first frame. Called from the route loader.
   */
  preHydrate: (knowledgeBaseId: string) => Promise<boolean>;
  /** `confirmed: false` renders the rows without persisting them (pending explorer overlays). */
  reconcile: (folderId: string, items: TreeItem[], options?: { confirmed?: boolean }) => void;
  removeItems: (itemIds: string[], parentId: string) => Promise<void>;
  renameItem: (itemId: string, parentId: string, newName: string) => Promise<void>;
  reset: () => void;
  revalidate: (folderId: string) => Promise<void>;
  /** Refetch every loaded folder — for a bulk mutation whose scope only the server knows. */
  revalidateLoaded: (fallbackKey?: string) => Promise<void>;
  snapshotMap: Record<string, LibraryTreeSnapshot>;
  snapshotReplica: ReplicaState<LibraryTreeSnapshot>;
  toggle: (folderId: string) => void;
}

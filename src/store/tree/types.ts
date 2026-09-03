import type { StoreHandle } from '@/store/utils/optimisticEngine';

export interface TreeItem {
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
  epoch: number;
  /** Last load error per folderId, so a failed fetch renders a failure state (with Retry) instead of a false "empty folder". */
  errors: Record<string, unknown>;
  expandAncestors: (folderIds: string[]) => Promise<void>;
  expanded: Record<string, boolean>;

  // actions
  init: (knowledgeBaseId: string) => void;
  knowledgeBaseId: string | null;
  loadChildren: (folderId: string) => Promise<void>;
  moveItem: (itemId: string, fromParent: string, toParent: string) => Promise<void>;
  moveItems: (itemIds: string[], fromParent: string, toParent: string) => Promise<void>;
  reconcile: (folderId: string, items: TreeItem[]) => void;
  removeItems: (itemIds: string[], parentId: string) => Promise<void>;
  renameItem: (itemId: string, parentId: string, newName: string) => Promise<void>;
  reset: () => void;
  revalidate: (folderId: string) => Promise<void>;
  toggle: (folderId: string) => void;
}

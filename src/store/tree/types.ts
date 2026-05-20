import type { StoreHandle } from '@/store/utils/optimisticEngine';

export interface TreeItem {
  fileType: string;
  id: string;
  isFolder: boolean;
  metadata?: Record<string, any>;
  name: string;
  slug?: string | null;
  sourceType?: string;
  url: string;
}

export interface TreeDataState {
  children: Record<string, TreeItem[]>;
  status: Record<string, 'idle' | 'loading' | 'revalidating'>;
}

export type TreeStoreHandle = StoreHandle<TreeDataState>;

export interface TreeState extends TreeDataState {
  epoch: number;
  expanded: Record<string, boolean>;
  // actions
  init: (knowledgeBaseId: string) => void;

  knowledgeBaseId: string | null;
  loadChildren: (folderId: string) => Promise<void>;
  moveItem: (itemId: string, fromParent: string, toParent: string) => Promise<void>;
  moveItems: (itemIds: string[], fromParent: string, toParent: string) => Promise<void>;
  navigateTo: (folderSlug: string) => Promise<void>;
  reconcile: (folderId: string, items: TreeItem[]) => void;
  removeItems: (itemIds: string[], parentId: string) => Promise<void>;
  renameItem: (itemId: string, parentId: string, newName: string) => Promise<void>;
  reset: () => void;
  revalidate: (folderId: string) => Promise<void>;
  toggle: (folderId: string) => void;
}

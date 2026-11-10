import { CUSTOM_FOLDER_FILE_TYPE } from '@lobechat/const';

import { hierarchySearchResource } from '@/features/ResourceManager/store/projection';
import { revalidateReplica } from '@/libs/replica';

import type { TreeItem } from './types';

/**
 * The library sidebar swaps the tree for a flat search list while a query is
 * typed; its rows reuse the tree's rename/move/delete actions. Those actions
 * only know the affected folder, so every tree revalidation also refreshes the
 * hierarchy search replica or a renamed/deleted hit would linger there.
 *
 * A revalidation only re-runs the *head* request, and the replica deliberately
 * keeps the rows the user already scrolled to. So dropping the loaded depth is
 * part of the refresh: without it a rename / move / deletion of a row past the
 * first page would leave the stale hit in the loaded tail. The same call drops
 * the searches only a previous session had persisted (never loaded here), which
 * no revalidation could otherwise reach.
 */
export const revalidateHierarchySearch = async (): Promise<void> => {
  const { useResourceManagerStore } = await import('@/features/ResourceManager/store');
  await useResourceManagerStore.getState().collapseHierarchySearch();
  await revalidateReplica(hierarchySearchResource);
};

const createdTime = (value?: Date | string): number => {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
};

/**
 * Folders first, then newest first inside each group.
 *
 * Every write path (`loadChildren`, `revalidate`, `reconcile`, the optimistic
 * move inserts) runs rows through this, so it — not the server — decides what
 * the sidebar shows. Ordering by name dropped a just-created row into the
 * middle of an A-Z list, which is neither where the user was looking nor what
 * the explorer shows: the resource query returns `created_at desc` and the
 * explorer's default sorter is `createdAt` / `Desc`. Name only breaks ties, and
 * rows with no timestamp (optimistic stubs, older cached payloads) sort as 0 so
 * they keep a stable A-Z tail instead of drifting.
 */
export const sortTreeItems = <T extends TreeItem>(items: T[]): T[] => {
  return [...items].sort((a, b) => {
    if (a.isFolder && !b.isFolder) return -1;
    if (!a.isFolder && b.isFolder) return 1;

    const aTime = createdTime(a.createdAt);
    const bTime = createdTime(b.createdAt);
    if (aTime !== bTime) return bTime - aTime;

    return a.name.localeCompare(b.name);
  });
};

/**
 * Whether a row has children to walk: every folder, plus a document the server
 * reports something under. Only for walking and expanding — folder navigation,
 * drop targets and folder-only actions keep checking `isFolder`.
 */
export const isExpandable = (item: Pick<TreeItem, 'hasChildren' | 'isFolder'>): boolean =>
  item.isFolder || !!item.hasChildren;

export const toTreeItem = (item: {
  createdAt?: Date | string | null;
  fileId?: string | null;
  fileType: string;
  hasChildren?: boolean;
  id: string;
  metadata?: Record<string, any> | null;
  name: string;
  parentId?: string | null;
  size?: number | null;
  slug?: string | null;
  sourceType?: string;
  url?: string;
  userId?: string | null;
  visibility?: 'private' | 'public' | null;
}): TreeItem => ({
  createdAt: item.createdAt ?? undefined,
  fileId: item.fileId,
  fileType: item.fileType,
  hasChildren: item.hasChildren,
  id: item.id,
  isFolder: item.fileType === CUSTOM_FOLDER_FILE_TYPE,
  metadata: item.metadata ?? undefined,
  name: item.name,
  parentId: item.parentId,
  size: item.size ?? undefined,
  slug: item.slug,
  sourceType: item.sourceType,
  url: item.url ?? '',
  userId: item.userId,
  visibility: item.visibility,
});

/**
 * Explorer row → tree row.
 *
 * Kept next to {@link toTreeItem} and named, rather than inlined at the
 * subscription that reconciles the explorer list into the sidebar, because it
 * is the one place tree rows are rebuilt from a *different* source: anything it
 * forgets to carry is silently dropped from every row the next time the list
 * refreshes. `visibility` and `userId` were lost that way — the sidebar stopped
 * marking private rows and the row menu mis-gated publish / make-private.
 */
export const toTreeItemFromResource = (item: {
  createdAt?: Date | string | null;
  fileId?: string | null;
  fileType: string;
  hasChildren?: boolean;
  id: string;
  metadata?: Record<string, any> | null;
  name: string;
  parentId?: string | null;
  size?: number | null;
  slug?: string | null;
  sourceType?: string;
  url?: string;
  userId?: string | null;
  visibility?: 'private' | 'public' | null;
}): TreeItem => toTreeItem(item);

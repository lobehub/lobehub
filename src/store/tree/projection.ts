import { defineReplica } from '@/libs/replica';

import { isExpandable } from './items';
import type { TreeItem } from './types';

/**
 * What a reload paints for one library's sidebar before the network answers:
 * the rows of the root and of every expanded folder the user can see, plus
 * which of those folders were open.
 */
export interface LibraryTreeSnapshot {
  children: Record<string, TreeItem[]>;
  expanded: string[];
}

/** Folders kept per library (the root counts), walked depth first from the root. */
export const MAX_PERSISTED_FOLDERS = 20;
/** Rows kept per folder; the first network answer brings the rest back. */
export const MAX_PERSISTED_ITEMS_PER_FOLDER = 200;

/**
 * Only the fields a sidebar row paints with. `url` can be a signed link, so it
 * never reaches storage; `metadata` keeps only the page emoji the row shows.
 */
const compactItem = (item: TreeItem): TreeItem => {
  const emoji = item.metadata?.emoji;
  return {
    createdAt: item.createdAt,
    fileId: item.fileId,
    fileType: item.fileType,
    hasChildren: item.hasChildren,
    id: item.id,
    isFolder: item.isFolder,
    metadata: emoji ? { emoji } : undefined,
    name: item.name,
    parentId: item.parentId,
    size: item.size,
    slug: item.slug,
    sourceType: item.sourceType,
    url: '',
    userId: item.userId,
    visibility: item.visibility,
  };
};

/**
 * The visible part of the tree, bounded. Collapsed folders are left out: their
 * rows would be a second, unrefreshed copy the next expand has to refetch anyway.
 */
export const buildLibraryTreeSnapshot = (
  children: Record<string, TreeItem[]>,
  expanded: Record<string, boolean>,
): LibraryTreeSnapshot | undefined => {
  if (!children['']) return undefined;

  const snapshot: LibraryTreeSnapshot = { children: {}, expanded: [] };
  const queue = [''];
  let folders = 0;

  while (queue.length > 0 && folders < MAX_PERSISTED_FOLDERS) {
    const folderId = queue.shift()!;
    const items = children[folderId];
    if (!items || folderId in snapshot.children) continue;

    const kept = items.slice(0, MAX_PERSISTED_ITEMS_PER_FOLDER);
    snapshot.children[folderId] = kept.map(compactItem);
    if (folderId) snapshot.expanded.push(folderId);
    folders += 1;

    for (const item of kept) {
      if (isExpandable(item) && expanded[item.id] && children[item.id]) queue.push(item.id);
    }
  }

  return snapshot;
};

/**
 * The library sidebar tree, one persisted row per library. The tree store keeps
 * its own `children` / `expanded` as the rendered state (its optimistic moves and
 * explorer reconciles write there); this replica only carries the last confirmed
 * view across reloads, partitioned by user + workspace like every replica.
 */
export const libraryTreeResource = defineReplica<{ libraryId: string }, LibraryTreeSnapshot>({
  key: ({ libraryId }) => libraryId,
  name: 'libraryTree',
  persist: { maxEntries: 20 },
  storage: 'indexedDB',
  version: 1,
});

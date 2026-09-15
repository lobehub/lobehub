import type { TreeItem } from '@/store/tree';

interface SelectionSource {
  currentFolderSlug?: string | null;
  currentViewItemId?: string | null;
}

export const resolveHierarchySelectedKey = ({
  currentFolderSlug,
  currentViewItemId,
}: SelectionSource): string | null => currentViewItemId ?? currentFolderSlug ?? null;

export const isHierarchyNodeActive = (
  item: Pick<TreeItem, 'id' | 'isFolder' | 'slug'>,
  selectedKey: string | null,
): boolean => {
  if (!selectedKey) return false;

  return item.isFolder ? selectedKey === (item.slug || item.id) : selectedKey === item.id;
};

/**
 * Whether `selectedKey` points at this folder or at anything inside it.
 *
 * Deleting a folder strands the explorer not only when it is parked in that
 * folder but also when it sits anywhere below it, so the caller has to weigh
 * the whole subtree rather than the row alone. Only loaded folders can be
 * walked: a selection under a folder the sidebar never expanded is invisible
 * here and the caller stays put, matching how the rest of the tree treats
 * folders it has not fetched.
 */
export const hierarchySubtreeHoldsSelection = (
  root: Pick<TreeItem, 'id' | 'isFolder' | 'slug'>,
  children: Record<string, TreeItem[]>,
  selectedKey: string | null,
): boolean => {
  if (!selectedKey) return false;
  if (isHierarchyNodeActive(root, selectedKey)) return true;

  const pending = [root.id];
  const seen = new Set<string>();

  while (pending.length > 0) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);

    for (const row of children[id] ?? []) {
      if (isHierarchyNodeActive(row, selectedKey)) return true;
      if (row.isFolder) pending.push(row.id);
    }
  }

  return false;
};

interface DeletedFolderRedirect {
  children: Record<string, TreeItem[]>;
  item: Pick<TreeItem, 'id' | 'isFolder' | 'slug'>;
  libraryId?: string | null;
  parentKey?: string;
  selectedKey: string | null;
}

/**
 * Where to send the explorer once a folder row is deleted, or `null` to leave
 * it where it is.
 *
 * Only moves when the explorer would otherwise be stranded — parked in the
 * deleted folder, or anywhere below it — and then only as far as the deleted
 * row's own parent (the library root when it sat at the top level).
 *
 * Every input is a snapshot the caller reads at call time, never one captured
 * when the row's menu was opened: the delete is async, so a user who navigates
 * away mid-request must not be yanked back to a folder they have already left.
 */
export const resolveDeletedFolderRedirect = ({
  children,
  item,
  libraryId,
  parentKey,
  selectedKey,
}: DeletedFolderRedirect): string | null => {
  if (!item.isFolder || !libraryId) return null;
  if (!hierarchySubtreeHoldsSelection(item, children, selectedKey)) return null;

  const parent = parentKey
    ? Object.values(children)
        .flat()
        .find((row) => row.id === parentKey)
    : undefined;
  const navKey = parent ? parent.slug || parent.id : '';

  return `/resource/library/${libraryId}${navKey ? `/${navKey}` : ''}`;
};

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

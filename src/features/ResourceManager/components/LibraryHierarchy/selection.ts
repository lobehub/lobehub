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

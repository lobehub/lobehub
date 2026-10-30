import { libraryFolderPath } from '@/features/ResourceManager/utils/resourcePath';
import { documentSelectors, useFileStore } from '@/store/file';
import { type TreeItem, useTreeStore } from '@/store/tree';

/**
 * Parent of an item the library sidebar has already loaded: the key of the
 * `children` group holding it (`null` for the root group), or `undefined` when
 * the item is not in the tree.
 */
export const findLoadedParentId = (
  children: Record<string, TreeItem[]>,
  itemId: string,
): string | null | undefined => {
  for (const [parentKey, rows] of Object.entries(children)) {
    if (rows.some((row) => row.id === itemId)) return parentKey || null;
  }
};

/**
 * Where Back leaves an item opened inside a library: the folder that holds it
 * (`/resource/library/<id>/folder/<parentId>`), or the library root when it
 * sits at the top level.
 *
 * The item's detail is fetched after it opens, so until it lands (or when it
 * fails) the parent comes from the rows the item was opened from: the sidebar
 * tree, then the explorer list. `undefined` means no source knows yet; `null`
 * is a confirmed top-level item.
 *
 * Pass no `itemId` outside a library item route; nothing is fetched then.
 */
export const useLibraryItemBackPath = (libraryId?: string | null, itemId?: string): string => {
  const useFetchKnowledgeItem = useFileStore((s) => s.useFetchKnowledgeItem);
  const { data: item } = useFetchKnowledgeItem(itemId);
  const document = useFileStore(documentSelectors.getDocumentById(itemId));
  const rowParentId = useFileStore((s) =>
    itemId ? s.resourceMap.get(itemId)?.parentId : undefined,
  );
  const treeParentId = useTreeStore((s) =>
    itemId ? findLoadedParentId(s.children, itemId) : undefined,
  );

  const parentId = [item?.parentId, document?.parentId, treeParentId, rowParentId].find(
    (candidate) => candidate !== undefined,
  );

  return libraryId ? libraryFolderPath(libraryId, parentId) : '';
};

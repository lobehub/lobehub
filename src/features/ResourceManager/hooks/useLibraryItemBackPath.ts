import { libraryFolderPath } from '@/features/ResourceManager/utils/resourcePath';
import { documentSelectors, useFileStore } from '@/store/file';

/**
 * Where Back leaves an item opened inside a library: the folder that holds it
 * (`/resource/library/<id>/folder/<parentId>`), or the library root when it
 * sits at the top level.
 *
 * Pass no `itemId` outside a library item route; nothing is fetched then.
 */
export const useLibraryItemBackPath = (libraryId?: string | null, itemId?: string): string => {
  const useFetchKnowledgeItem = useFileStore((s) => s.useFetchKnowledgeItem);
  const { data: item } = useFetchKnowledgeItem(itemId);
  const document = useFileStore(documentSelectors.getDocumentById(itemId));
  const parentId = item?.parentId ?? document?.parentId;

  return libraryId ? libraryFolderPath(libraryId, parentId) : '';
};

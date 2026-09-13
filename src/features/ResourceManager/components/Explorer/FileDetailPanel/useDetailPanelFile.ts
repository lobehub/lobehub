import { fileManagerSelectors, useFileStore } from '@/store/file';
import { type FileListItem } from '@/types/files';

/**
 * Resolve the resource shown in the detail panel: the already-loaded list entry
 * when there is one, otherwise a single-item fetch (e.g. the list page has not
 * reached it yet, or it belongs to another view).
 */
export const useDetailPanelFile = (id?: string): FileListItem | undefined => {
  const fromStore = useFileStore(fileManagerSelectors.getFileById(id));
  const useFetchKnowledgeItem = useFileStore((s) => s.useFetchKnowledgeItem);
  const { data: fromQuery } = useFetchKnowledgeItem(!fromStore ? id : undefined);

  return fromStore ?? fromQuery;
};

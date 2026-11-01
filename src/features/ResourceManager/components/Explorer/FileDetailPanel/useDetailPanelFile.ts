import { fileManagerSelectors, useFileStore } from '@/store/file';
import { type FileListItem } from '@/types/files';

/**
 * Resolve the resource shown in the detail panel: the already-loaded row when
 * there is one, otherwise a single-item fetch (e.g. the list page has not
 * reached it yet, or it belongs to another view). Explorer rows live in the
 * resource store (`resourceMap`), not the legacy `fileList`, so both are checked
 * before falling back to the request.
 */
export const useDetailPanelFile = (id?: string): FileListItem | undefined => {
  const fromStore = useFileStore(
    (s) =>
      fileManagerSelectors.getFileById(id)(s) ??
      (id ? (s.resourceMap.get(id) as FileListItem | undefined) : undefined),
  );
  const useFetchKnowledgeItem = useFileStore((s) => s.useFetchKnowledgeItem);
  const { data: fromQuery } = useFetchKnowledgeItem(!fromStore ? id : undefined);

  return fromStore ?? fromQuery;
};

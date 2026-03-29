import { useResourceManagerFetchFolderBreadcrumb } from '../store';
import { useFolderPath } from './useFolderPath';

export const useCurrentFolderId = () => {
  const { currentFolderSlug } = useFolderPath();
  const { data: folderBreadcrumb } = useResourceManagerFetchFolderBreadcrumb(currentFolderSlug);

  return folderBreadcrumb?.at(-1)?.id || null;
};

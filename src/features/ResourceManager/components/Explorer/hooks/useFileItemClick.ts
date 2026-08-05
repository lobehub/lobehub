import { useCallback } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';

export interface UseFileItemClickOptions {
  id: string;
  isFolder: boolean;
  isPage: boolean;
  libraryId?: string | null;
  onOpen?: (id: string) => void;
  slug?: string | null;
}

/**
 * Shared hook for handling file item click across different view modes (list/masonry)
 */
export const useFileItemClick = ({
  id,
  slug,
  libraryId,
  isFolder,
  isPage,
  onOpen,
}: UseFileItemClickOptions) => {
  const navigate = useWorkspaceAwareNavigate();
  // Read/write the URL through the active-tab facade rather than
  // `useSearchParams`: this hook also runs in the library sidebar, which Electron
  // portals into the shell's frozen root router.
  const { search } = useActiveLocation();
  const setMode = useResourceManagerStore((s) => s.setMode);
  const setCurrentViewItemId = useResourceManagerStore((s) => s.setCurrentViewItemId);

  const handleClick = useCallback(() => {
    const selectFile = () => {
      const newParams = new URLSearchParams(search);
      newParams.set('file', id);
      navigate({ search: `?${newParams.toString()}` }, { replace: true });
    };

    if (isFolder) {
      // Navigate to folder using slug-based routing (Google Drive style)
      const folderSlug = slug || id;

      if (libraryId) {
        // Preserve existing query parameters (view and sort preferences)
        const newParams = new URLSearchParams(search);
        // Remove 'file' parameter when navigating to folder
        newParams.delete('file');

        const queryString = newParams.toString();
        const basePath = `/resource/library/${libraryId}/${folderSlug}`;
        navigate(queryString ? `${basePath}?${queryString}` : basePath);
      }
    } else if (isPage) {
      // Switch to page view mode
      setCurrentViewItemId(id);
      setMode('page');
      // Update URL query parameter for shareable links
      selectFile();
    } else {
      // Set mode to editor for regular files
      setCurrentViewItemId(id);
      setMode('editor');
      // Update URL query parameter for shareable links
      selectFile();
      // Call onOpen if provided for backwards compatibility
      onOpen?.(id);
    }
  }, [
    isFolder,
    slug,
    id,
    libraryId,
    isPage,
    navigate,
    search,
    setMode,
    setCurrentViewItemId,
    onOpen,
  ]);

  return handleClick;
};

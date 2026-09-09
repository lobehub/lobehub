import { useCallback } from 'react';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';

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
  const { pathname, search } = useActiveLocation();
  const setMode = useResourceManagerStore((s) => s.setMode);
  const setCurrentViewItemId = useResourceManagerStore((s) => s.setCurrentViewItemId);
  const openDetailPanel = useResourceManagerStore((s) => s.openDetailPanel);

  const handleClick = useCallback(() => {
    const selectFile = () => {
      const newParams = new URLSearchParams(search);
      newParams.set('file', id);

      // The library sidebar stays mounted on the standalone Permissions page.
      // A search-only navigation there would keep the tab on `/permission`, so
      // selecting a page/file appeared to do nothing. Return to the library
      // surface first, then let its `file` query restore the selected content.
      if (libraryId && pathname.endsWith(`/resource/library/${libraryId}/permission`)) {
        navigate(`/resource/library/${libraryId}?${newParams.toString()}`);
        return;
      }

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
      // Open the in-context detail panel instead of leaving the list. A plain
      // click is a "look at this" gesture — the promise of this surface is to
      // keep the working list visible. Fullscreen focus stays available as the
      // explicit double click (see `openFileEditor`).
      openDetailPanel(id);
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
    pathname,
    search,
    setMode,
    setCurrentViewItemId,
    openDetailPanel,
    onOpen,
  ]);

  return handleClick;
};

/**
 * Double click = the committed "open this file" gesture: leave the list into
 * the fullscreen editor, exactly what a single click used to do. Keeps the
 * `?file=` deep-link write so a restored tab still lands on this file.
 */
export const useFileItemDoubleClick = ({ id }: { id: string }) => {
  const setMode = useResourceManagerStore((s) => s.setMode);
  const setCurrentViewItemId = useResourceManagerStore((s) => s.setCurrentViewItemId);
  const closeDetailPanel = useResourceManagerStore((s) => s.closeDetailPanel);
  const { search } = useActiveLocation();
  const navigate = useWorkspaceAwareNavigate();

  return useCallback(() => {
    closeDetailPanel();
    setCurrentViewItemId(id);
    setMode('editor');

    const newParams = new URLSearchParams(search);
    newParams.set('file', id);
    navigate({ search: `?${newParams.toString()}` }, { replace: true });
  }, [closeDetailPanel, id, setCurrentViewItemId, setMode, navigate, search]);
};

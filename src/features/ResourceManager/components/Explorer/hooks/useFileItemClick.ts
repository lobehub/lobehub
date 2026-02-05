import { useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';

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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const setMode = useResourceManagerStore((s) => s.setMode);
  const setCurrentViewItemId = useResourceManagerStore((s) => s.setCurrentViewItemId);

  const handleClick = useCallback(() => {
    if (isFolder) {
      // Navigate to folder using slug-based routing (Google Drive style)
      const folderSlug = slug || id;

      if (libraryId) {
        // Preserve existing query parameters (view and sort preferences)
        const newParams = new URLSearchParams(searchParams);
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
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev);
          newParams.set('file', id);
          return newParams;
        },
        { replace: true },
      );
    } else {
      // Set mode to editor for regular files
      setCurrentViewItemId(id);
      setMode('editor');
      // Update URL query parameter for shareable links
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev);
          newParams.set('file', id);
          return newParams;
        },
        { replace: true },
      );
      // Call onOpen if provided for backwards compatibility
      onOpen?.(id);
    }
  }, [isFolder, slug, id, libraryId, isPage, navigate, searchParams, setSearchParams, setMode, setCurrentViewItemId, onOpen]);

  return handleClick;
};

import { useCallback, useEffect } from 'react';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { type ViewMode } from '@/features/ResourceManager/store/initialState';
import { parseAsStringEnum, useQueryState } from '@/hooks/useQueryParam';
import { FilesTabs } from '@/types/files';

/**
 * Categories whose content is media first — they open in the gallery
 * (masonry) view unless the URL explicitly asks for another one.
 */
const GALLERY_FIRST_CATEGORIES = new Set<FilesTabs>([
  FilesTabs.Audios,
  FilesTabs.Images,
  FilesTabs.Videos,
  FilesTabs.Websites,
]);

/**
 * Hook to manage view mode with URL query sync
 * Returns [viewMode, setViewMode] tuple like useState
 * Handles bidirectional sync between store and URL query parameter
 */
export const useViewMode = (): [ViewMode, (mode: ViewMode) => void] => {
  // View mode from store
  const [category, libraryId, viewModeFromStore, setViewModeInStore] = useResourceManagerStore(
    (s) => [s.category, s.libraryId, s.viewMode, s.setViewMode],
  );

  // Inside a library the category filter is not applied, so the stale home
  // category must not leak its gallery default there.
  const defaultViewMode: ViewMode =
    !libraryId && GALLERY_FIRST_CATEGORIES.has(category) ? 'masonry' : 'list';

  // Sync view mode with URL query parameter
  const [viewModeFromUrl, setViewModeInUrl] = useQueryState(
    'view',
    parseAsStringEnum(['list', 'masonry'] as const).withDefault(defaultViewMode),
  );

  useEffect(() => {
    setViewModeInStore(viewModeFromUrl);
  }, [viewModeFromUrl]);

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      setViewModeInStore(mode);
      setViewModeInUrl(mode);
    },
    [setViewModeInStore, setViewModeInUrl],
  );

  return [viewModeFromStore, setViewMode];
};

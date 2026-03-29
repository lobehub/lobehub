import { useEffect } from 'react';

import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import type { FilesTabs } from '@/types/files';

interface ResetSelectionOnQueryChangeOptions {
  category: FilesTabs;
  currentFolderSlug?: string | null;
  libraryId?: string;
  searchQuery: string | null;
}

export const useResetSelectionOnQueryChange = ({
  category,
  currentFolderSlug,
  libraryId,
  searchQuery,
}: ResetSelectionOnQueryChangeOptions) => {
  const clearSelectAllState = useResourceManagerStore((s) => s.clearSelectAllState);

  useEffect(() => {
    clearSelectAllState();
  }, [category, clearSelectAllState, currentFolderSlug, libraryId, searchQuery]);
};

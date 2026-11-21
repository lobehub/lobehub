import { useEffect } from 'react';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import type { FilesTabs } from '@/types/files';

interface ResetSelectionOnQueryChangeOptions {
  category: FilesTabs;
  currentFolderId?: string | null;
  libraryId?: string;
  searchQuery: string | null;
}

export const useResetSelectionOnQueryChange = ({
  category,
  currentFolderId,
  libraryId,
  searchQuery,
}: ResetSelectionOnQueryChangeOptions) => {
  const clearSelectAllState = useResourceManagerStore((s) => s.clearSelectAllState);

  useEffect(() => {
    clearSelectAllState();
  }, [category, clearSelectAllState, currentFolderId, libraryId, searchQuery]);
};

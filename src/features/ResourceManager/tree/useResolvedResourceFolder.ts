import { useEffect, useState } from 'react';

import { fileService } from '@/services/file';

interface ResolvedResourceFolder {
  ancestorIds: string[];
  folderId: string | null;
  isLoading: boolean;
}

interface FolderBreadcrumbItem {
  id: string;
}

const ROOT_FOLDER_STATE: ResolvedResourceFolder = {
  ancestorIds: [],
  folderId: null,
  isLoading: false,
};

export const useResolvedResourceFolder = (folderSlug?: string | null): ResolvedResourceFolder => {
  const [resolvedFolder, setResolvedFolder] = useState<ResolvedResourceFolder>(ROOT_FOLDER_STATE);

  useEffect(() => {
    if (!folderSlug) {
      setResolvedFolder(ROOT_FOLDER_STATE);
      return;
    }

    let isActive = true;

    setResolvedFolder((previous) => ({ ...previous, isLoading: true }));

    const resolveFolder = async () => {
      try {
        const breadcrumb = await fileService.getFolderBreadcrumb(folderSlug);

        if (!isActive) return;

        const ancestorIds = breadcrumb.map(({ id }: FolderBreadcrumbItem) => id);

        setResolvedFolder({
          ancestorIds,
          folderId: ancestorIds.at(-1) ?? null,
          isLoading: false,
        });
      } catch (error) {
        if (!isActive) return;

        console.error(`Failed to resolve resource folder for ${folderSlug}:`, error);
        setResolvedFolder((previous) => ({ ...previous, isLoading: false }));
      }
    };

    void resolveFolder();

    return () => {
      isActive = false;
    };
  }, [folderSlug]);

  return resolvedFolder;
};

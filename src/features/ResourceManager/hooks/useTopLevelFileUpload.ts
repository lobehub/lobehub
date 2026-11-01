import { useCallback } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useCurrentFolderId } from '@/features/ResourceManager/hooks/useCurrentFolderId';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { useFileStore } from '@/store/file';

/**
 * Shared driver for ResourceManager top-level file uploads.
 *
 * The Sidebar mode toggle (`listVisibility`) is the source of truth — the
 * user has already chosen which "space" they're in, so we translate that
 * directly into the upload's `visibility`:
 *
 * - **workspace mode + top level** (`!libraryId && !currentFolderId`): the
 *   mode picks visibility (`'private'` → private drawer, `'workspace'` →
 *   team share). No modal, no prompt.
 * - **inside a library or folder**: leave visibility `undefined`; the server
 *   resolves it from the parent document or library boundary so uploads stay
 *   in the same private/workspace-visible scope.
 * - **personal mode** (no `activeWorkspaceId`): also `undefined`; personal
 *   rows have no visibility column semantics.
 */
interface UseTopLevelFileUploadOptions {
  /**
   * Upload to the library's root instead of the folder the URL is in (the
   * sidebar toolbar's library-level "+").
   */
  rootLevel?: boolean;
}

export const useTopLevelFileUpload = ({ rootLevel }: UseTopLevelFileUploadOptions = {}) => {
  const activeWorkspaceId = useActiveWorkspaceId();
  const urlFolderId = useCurrentFolderId();
  const currentFolderId = rootLevel ? null : urlFolderId;
  const libraryId = useResourceManagerStore((s) => s.libraryId);
  const listVisibility = useResourceManagerStore((s) => s.listVisibility);
  const pushDockFileList = useFileStore((s) => s.pushDockFileList);

  const isTopLevelWorkspace = !!activeWorkspaceId && !libraryId && !currentFolderId;
  const visibility: 'private' | 'public' | undefined = isTopLevelWorkspace
    ? listVisibility === 'private'
      ? 'private'
      : 'public'
    : undefined;

  return useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      await pushDockFileList(files, libraryId, currentFolderId ?? undefined, visibility);
    },
    [libraryId, currentFolderId, pushDockFileList, visibility],
  );
};

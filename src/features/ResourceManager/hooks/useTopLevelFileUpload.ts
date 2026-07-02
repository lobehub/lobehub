import { useCallback } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useCurrentFolderId } from '@/routes/(main)/resource/features/hooks/useCurrentFolderId';
import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
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
 *   inherits the parent document's visibility so a private folder's uploads
 *   stay private, and a workspace folder's uploads stay workspace-shared.
 * - **personal mode** (no `activeWorkspaceId`): also `undefined`; personal
 *   rows have no visibility column semantics.
 */
export const useTopLevelFileUpload = () => {
  const activeWorkspaceId = useActiveWorkspaceId();
  const currentFolderId = useCurrentFolderId();
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

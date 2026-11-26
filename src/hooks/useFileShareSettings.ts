import type { FileShareVisibility } from '@lobechat/types';
import { useCallback } from 'react';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';

/**
 * One key for every entry to a file's share (generation share modal, resource
 * library share popover and header button), so they all show the same state.
 */
export const fileShareSettingsKey = (fileId: string) => ['fileShare.getShareSettings', fileId];

/**
 * A file's share settings plus the write that updates them.
 *
 * The read goes through `useClientDataSWR` and the write through the scoped
 * `mutate`: both append the active workspace id to the key. A plain `useSWR`
 * read keeps the bare key, so inside a workspace the write never reaches it and
 * the switch stays off until the panel is reopened.
 */
export const useFileShareSettings = (fileId: string | undefined) => {
  const {
    data,
    error,
    isLoading,
    mutate: revalidate,
  } = useClientDataSWR(
    fileId ? fileShareSettingsKey(fileId) : null,
    () => lambdaClient.fileShare.getShareSettings.query({ fileId: fileId! }),
    { revalidateOnFocus: false },
  );

  const updateVisibility = useCallback(
    async (visibility: FileShareVisibility) => {
      if (!fileId) return null;
      const next = await lambdaClient.fileShare.updateShareSettings.mutate({ fileId, visibility });
      await mutate(fileShareSettingsKey(fileId), next, { revalidate: false });
      return next;
    },
    [fileId],
  );

  return { data, error, isLoading, revalidate, updateVisibility };
};

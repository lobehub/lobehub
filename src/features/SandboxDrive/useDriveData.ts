import type { SandboxDrive } from '@lobechat/builtin-tool-cloud-sandbox';
import { useCallback } from 'react';
import { useSWRConfig } from 'swr';

import { useClientDataSWR } from '@/libs/swr';
import { sandboxStorageService } from '@/services/sandboxStorage';

const USAGE_KEY = 'sandbox-drive-usage';
const FILES_KEY = 'sandbox-drive-files';
const DIRECTORIES_KEY = 'sandbox-drive-directories';

/**
 * Every drive's usage against the pool, and each member's for an admin.
 * `useClientDataSWR` keys it by the active workspace, so switching workspaces
 * never shows the previous one's figures.
 */
export const useDriveUsage = () => {
  const swr = useClientDataSWR<Awaited<ReturnType<typeof sandboxStorageService.getDriveUsage>>>(
    [USAGE_KEY],
    () => sandboxStorageService.getDriveUsage(),
    { revalidateOnFocus: false },
  );

  // Measuring walks each of the caller's own drives; the members' figures are
  // whatever was last measured for them.
  const refresh = useCallback(async () => {
    const drives = swr.data?.drives.map((entry) => entry.drive) ?? [];
    await Promise.all(
      drives.map((drive) =>
        sandboxStorageService.refreshStorageUsage({ drive }).catch(() => undefined),
      ),
    );
    await swr.mutate();
  }, [swr.data, swr.mutate]);

  return { data: swr.data, error: swr.error, isLoading: swr.isLoading, refresh };
};

/** One folder's entries on one drive. */
export const useDriveFiles = (drive: SandboxDrive, path: string) =>
  useClientDataSWR<Awaited<ReturnType<typeof sandboxStorageService.listFiles>>>(
    [FILES_KEY, drive, path],
    () => sandboxStorageService.listFiles({ drive, path: path || undefined }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

/**
 * The environment directories on one drive — from the database, so the root
 * listing can badge them without waiting on a sandbox for sizes.
 */
export const useDriveDirectories = (drive: SandboxDrive) =>
  useClientDataSWR<Awaited<ReturnType<typeof sandboxStorageService.listInstances>>>(
    [DIRECTORIES_KEY, drive],
    () => sandboxStorageService.listInstances({ drive, withSizes: false }),
    { revalidateOnFocus: false },
  );

/** Refetch every listing of every drive, and the usage, after a write. */
export const useRefreshDrive = () => {
  const { mutate } = useSWRConfig();

  return useCallback(
    () =>
      mutate(
        (key) =>
          Array.isArray(key) &&
          (key[0] === FILES_KEY || key[0] === DIRECTORIES_KEY || key[0] === USAGE_KEY),
      ),
    [mutate],
  );
};

import type { DeviceDirectoryBrowseResult } from '@lobechat/types';
import useSWRInfinite from 'swr/infinite';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { deviceKeys } from '@/libs/swr/keys';
import { deviceService } from '@/services/device';

/** Each device/path has its own page series, so late responses cannot replace a new location. */
export const useFetchDeviceDirectory = (deviceId: string, path?: string) => {
  const workspaceId = useActiveWorkspaceId();
  const { data, error, isLoading, isValidating, mutate, setSize, size } = useSWRInfinite(
    (_index: number, previous: DeviceDirectoryBrowseResult | null) => {
      if (previous && !previous.nextCursor) return null;
      return deviceKeys.browseDirectory(
        workspaceId,
        deviceId,
        previous?.path ?? path,
        previous?.nextCursor,
      );
    },
    async ([, , targetDeviceId, directoryPath, cursor]: readonly [
      string,
      string | null,
      string,
      string | undefined,
      string | undefined,
    ]) => {
      const result = await deviceService.browseDirectory({
        cursor,
        deviceId: targetDeviceId,
        path: directoryPath,
      });
      // Offline / unsupported RPC is returned as null, never an empty directory.
      if (!result) throw new Error('Device directory unavailable');
      return result;
    },
    {
      revalidateFirstPage: false,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );

  const directory = data?.[0];
  const entries = data?.flatMap((page) => page?.entries ?? []) ?? [];
  const lastPage = data?.findLast(Boolean);

  return {
    directory,
    entries,
    error,
    hasMore: !!lastPage?.nextCursor,
    isLoading,
    isLoadingMore: !error && (isValidating || (!!directory && !data?.[size - 1])),
    loadMore: () => setSize(size + 1),
    retry: () => mutate(),
  };
};

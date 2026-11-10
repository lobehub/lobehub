import type { DeviceGitBranchListItem } from '@lobechat/types';
import { useCallback, useMemo } from 'react';

import { useFetchGitBranches } from '@/store/device';
import { getGitStatusStoreState } from '@/store/device/gitStatus/store';

const EMPTY: DeviceGitBranchListItem[] = [];

/**
 * The branch switcher's list. Read while the dropdown is open; the list
 * persisted last session paints the moment it opens and the device read
 * refreshes it. A failed refresh keeps that list on screen — only a failure
 * with nothing to show reads as "couldn't load".
 */
export const useBranchList = (deviceId: string | undefined, path: string, open: boolean) => {
  const { data, error, isLoading, mutate } = useFetchGitBranches(deviceId, path, open);
  const branches = data ?? EMPTY;

  /**
   * Re-read after a branch write (create / rename / delete), whether or not the
   * dropdown is open, so its next open never paints a branch that is gone.
   */
  const refreshBranches = useCallback(
    () => getGitStatusStoreState().refreshGitBranches(deviceId, path),
    [deviceId, path],
  );

  return useMemo(
    () => ({
      branches,
      error,
      isLoading,
      loadFailed: !isLoading && !!error && branches.length === 0,
      refreshBranches,
      revalidate: () => mutate(),
    }),
    [branches, error, isLoading, mutate, refreshBranches],
  );
};

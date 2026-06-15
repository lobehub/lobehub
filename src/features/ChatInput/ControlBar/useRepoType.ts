import { isDesktop } from '@lobechat/const';
import { useEffect, useMemo } from 'react';
import useSWR from 'swr';

import { deviceKeys } from '@/libs/swr/keys';
import { electronGitService } from '@/services/electron/git';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';

import { getRecentDirs, setRecentDirRepoType } from './recentDirs';

export type RepoType = 'git' | 'github' | undefined;

/**
 * Resolve the repo type for a working directory on `deviceId` (the local machine
 * when omitted).
 *
 * Primary source is the device's persisted `workingDirs[].repoType` (committed
 * by the picker, backfilled by `statPath`) — hydrated from `listDevices`, so it
 * works for remote devices too. Falls back, only when the target is the local
 * machine, to the legacy localStorage recents + an IPC probe (backfilling the
 * cache) for paths that never went through the picker. A remote device's
 * filesystem isn't probeable here, so it relies on the persisted value.
 */
export const useRepoType = (path?: string, deviceId?: string): RepoType => {
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const isLocalTarget = !deviceId || deviceId === currentDeviceId;

  // Persisted repoType from the (local or remote) device's working dirs.
  const fromDevice = useDeviceStore((s) =>
    path
      ? deviceSelectors
          .getDeviceWorkingDirs(deviceId)(s)
          .find((d) => d.path === path)?.repoType
      : undefined,
  );

  // Legacy localStorage fast path — local machine only.
  const cachedLocal = useMemo<RepoType>(() => {
    if (!isLocalTarget || !path) return undefined;
    return getRecentDirs().find((d) => d.path === path)?.repoType;
  }, [isLocalTarget, path]);

  const cached = fromDevice ?? cachedLocal;

  const shouldProbe = isDesktop && isLocalTarget && !!path && !cached;

  const { data: probed } = useSWR(
    shouldProbe ? deviceKeys.repoType(path!) : null,
    () => electronGitService.detectRepoType(path!),
    {
      dedupingInterval: 60 * 1000,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );

  useEffect(() => {
    if (isLocalTarget && path && probed !== undefined) setRecentDirRepoType(path, probed);
  }, [isLocalTarget, path, probed]);

  return cached ?? probed;
};

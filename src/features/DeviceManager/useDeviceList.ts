import { isDesktop } from '@lobechat/const';
import type { DeviceListItem } from '@lobechat/types';
import type { SWRResponse } from 'swr';

import { useClientDataSWR } from '@/libs/swr';
import { deviceService } from '@/services/device';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { DEVICE_LIST_SWR_KEY } from './const';

/**
 * Workspace-aware device list. ALWAYS use this (not
 * `lambdaQuery.device.listDevices.useQuery`) for any surface that lists or
 * resolves devices: `useClientDataSWR` augments the cache key with the active
 * workspace id, so switching workspaces re-fetches into a fresh cache entry.
 * The raw TRPC React Query key has no workspace dimension — a list primed in
 * one workspace kept serving a stale pool after switching (LOBE-11904), and a
 * fetch primed while the workspace was still resolving stuck for the whole
 * session (the DeviceManager fix this generalizes).
 *
 * Devices come from an authed lambda procedure, so only query once signed in
 * (desktop always queries — it lists the local device's registered cwd).
 *
 * Refresh: `refreshDeviceList()` (`./const`) revalidates every workspace
 * context's entry; the returned `mutate` revalidates just the active one.
 */
export const useDeviceList = (): SWRResponse<DeviceListItem[]> => {
  const isLogin = useUserStore(authSelectors.isLogin);
  return useClientDataSWR<DeviceListItem[]>(
    isLogin || isDesktop ? [DEVICE_LIST_SWR_KEY] : null,
    () => deviceService.listDevices(),
  );
};

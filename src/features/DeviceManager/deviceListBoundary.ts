import type { DeviceListItem } from '@lobechat/types';

import type { DeviceListResult } from '@/store/device';

type BoundaryInput = Pick<
  DeviceListResult,
  'data' | 'error' | 'isConfirmed' | 'isLoading' | 'isValidating'
>;

/**
 * `AsyncBoundary`'s `data` / `isLoading` for a device page that shows part of
 * the list (one pool, one device).
 *
 * A reload restores the list from storage before the server answers, and that
 * copy may be stale or miss rows — so `isEmpty` (no device in this pool, the
 * opened device missing) only counts once the server confirmed the list.
 * Before that the surface stays loading, and a failed refresh reaches the
 * error state instead of settling on onboarding or "not found".
 */
export const getDeviceListBoundary = (
  list: BoundaryInput,
  isEmpty: boolean,
): { data: DeviceListItem[] | undefined; isLoading: boolean } => {
  const isPending = !list.isConfirmed && isEmpty;

  return {
    data: isPending ? undefined : list.data,
    isLoading: list.isLoading || (isPending && (!list.error || list.isValidating)),
  };
};

/**
 * React key for the device detail. It seeds its rename / cwd drafts from the
 * row on mount, so it remounts when the route moves to another device and once
 * the server confirms a row that was painted from storage — drafts seeded from
 * a stale stored row would otherwise write the old name or `workingDirs` back.
 */
export const deviceDetailKey = (deviceId: string, isConfirmed: boolean): string =>
  `${deviceId}:${isConfirmed ? 'server' : 'stored'}`;

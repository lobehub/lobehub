import { mutate } from '@/libs/swr';

/**
 * SWR cache key for the device list. Fetched via `useClientDataSWR`, which
 * augments the key with the active workspace id (`[KEY, workspaceId]`) so the
 * personal and per-workspace device pools never share a cache entry. Always an
 * array so the augmented and personal forms match the same prefix.
 */
export const DEVICE_LIST_SWR_KEY = 'device/listDevices';

/** Revalidate the device list across whichever workspace context is active. */
export const refreshDeviceList = () =>
  mutate((key: unknown) => Array.isArray(key) && key[0] === DEVICE_LIST_SWR_KEY);

import { getDeviceStoreState } from '@/store/device';

/**
 * Re-fetch the device list. It lives in the device store's replica, which is
 * partitioned by user + workspace, so this refreshes whichever pool is active.
 */
export const refreshDeviceList = () => getDeviceStoreState().refreshDevices();

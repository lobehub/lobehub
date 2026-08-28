export type DeviceListState = 'empty' | 'loading' | 'ready';

interface GetDeviceListStateOptions {
  hasDevices: boolean;
  isFetching: boolean;
}

export const getDeviceListState = ({
  hasDevices,
  isFetching,
}: GetDeviceListStateOptions): DeviceListState => {
  if (hasDevices) return 'ready';
  return isFetching ? 'loading' : 'empty';
};

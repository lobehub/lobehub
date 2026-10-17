import type { DeviceListItem } from '@lobechat/types';

/**
 * Sentinel for "run on this machine". Not an empty string: Select treats `''`
 * as no value and renders a blank trigger instead of the option's label.
 */
export const LOCAL_TARGET = '__local__';

interface TargetOption {
  label: string;
  value: string;
}

/** Options for the terminal target picker; `localLabel` adds "this machine" first. */
export const buildTargetOptions = (
  devices: DeviceListItem[],
  localLabel?: string,
): TargetOption[] => [
  ...(localLabel ? [{ label: localLabel, value: LOCAL_TARGET }] : []),
  ...devices.map((device) => ({
    label: device.friendlyName || device.hostname || device.deviceId,
    value: device.deviceId,
  })),
];

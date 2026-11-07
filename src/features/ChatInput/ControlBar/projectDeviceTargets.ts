import type { DeviceListItem } from '@lobechat/types';

import type { ProjectDirectory } from '@/store/projectWorkingDirectory';

export interface ProjectDeviceTarget {
  active: boolean;
  /** False when the agent is fixed to another device — the move would be refused. */
  allowed: boolean;
  /** The registered device behind the directory, when the device list knows it. */
  device?: DeviceListItem;
  directory: ProjectDirectory;
  label: string;
  online: boolean;
  /** The device row is a persisted copy the server has not confirmed: presence unknown. */
  onlineUnknown: boolean;
}

export const projectDirectoryDeviceName = (
  directory: ProjectDirectory,
  devices: DeviceListItem[] | undefined,
) => {
  const device = devices?.find((item) => item.deviceId === directory.deviceId);
  return device?.friendlyName || directory.deviceName || device?.hostname || directory.deviceId;
};

/**
 * The devices a project-directory conversation may switch to: one per project
 * directory that can host a run. A device without the project's directory is
 * not a target — the directory belongs to the project, so there is nothing to
 * run in there — and a legacy or read-only directory cannot host a run. An
 * agent fixed to one device in its profile cannot be moved anywhere else, so
 * every other device is listed but not allowed.
 */
export const listProjectDeviceTargets = (
  directories: ProjectDirectory[],
  devices: DeviceListItem[] | undefined,
  currentDirectoryId: string | undefined,
  fixedDeviceId?: string,
): ProjectDeviceTarget[] =>
  directories
    .filter((d) => d.instanceId && d.permission === 'readWrite')
    .map((directory) => {
      const device = devices?.find((item) => item.deviceId === directory.deviceId);
      return {
        active: directory.id === currentDirectoryId,
        allowed: !fixedDeviceId || directory.deviceId === fixedDeviceId,
        device,
        directory,
        label: projectDirectoryDeviceName(directory, devices),
        online: !!device?.online,
        onlineUnknown: !!device?.onlineUnknown,
      };
    });

import type { DeviceListItem } from '@lobechat/types';

import type { ProjectDirectory } from '@/store/projectWorkingDirectory';

export interface ProjectDeviceTarget {
  active: boolean;
  directory: ProjectDirectory;
  label: string;
  online: boolean;
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
 * run in there — and a legacy or read-only directory cannot host a run.
 */
export const listProjectDeviceTargets = (
  directories: ProjectDirectory[],
  devices: DeviceListItem[] | undefined,
  currentDirectoryId: string | undefined,
): ProjectDeviceTarget[] =>
  directories
    .filter((d) => d.instanceId && d.permission === 'readWrite')
    .map((directory) => ({
      active: directory.id === currentDirectoryId,
      directory,
      label: projectDirectoryDeviceName(directory, devices),
      online: !!devices?.find((item) => item.deviceId === directory.deviceId)?.online,
    }));

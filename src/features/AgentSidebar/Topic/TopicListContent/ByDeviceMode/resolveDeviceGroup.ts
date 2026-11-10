import { canStageDraftOn } from '@/features/Projects/WorkingDirectories/startProjectTopicDraft';

interface DeviceDirectoryLike {
  deviceId?: string | null;
  environmentId?: string | null;
  id: string;
  instanceId?: string | null;
  permission?: string | null;
}

/**
 * The add-topic affordance on a device group is only safe with a runnable
 * directory on THIS device that the draft's agent may run on — otherwise the
 * blank conversation would be staged somewhere the first send is refused, or
 * on another device altogether. A group for this machine passes all of its
 * device identities, tried in order (its personal device first).
 */
export const findDeviceTopicDirectory = <T extends DeviceDirectoryLike>(
  directories: T[],
  deviceIds?: string | readonly string[],
  fixedDeviceId?: string | null,
): T | undefined => {
  for (const deviceId of typeof deviceIds === 'string' ? [deviceIds] : (deviceIds ?? [])) {
    const directory = directories.find(
      (d) => d.deviceId === deviceId && canStageDraftOn(d, fixedDeviceId),
    );
    if (directory) return directory;
  }
};

/**
 * Whether another device is shown under the same name as this group — e.g.
 * one machine's personal and workspace identities, which only this machine can
 * merge. `ownIds` are the group's own identities, never counted as namesakes.
 * Names resolve like the group title: project directory name, then the
 * device's friendly name, then its hostname.
 */
export const hasNamesakeDevice = ({
  devices,
  directories,
  name,
  ownIds,
}: {
  devices: { deviceId: string; friendlyName?: string | null; hostname?: string | null }[];
  directories: { deviceId?: string | null; deviceName?: string | null }[];
  name: string;
  ownIds: readonly string[];
}): boolean => {
  const ids = new Set<string>();
  for (const item of [...devices, ...directories]) if (item.deviceId) ids.add(item.deviceId);
  for (const id of ids) {
    if (ownIds.includes(id)) continue;
    const device = devices.find((item) => item.deviceId === id);
    const otherName =
      directories.find((item) => item.deviceId === id && item.deviceName)?.deviceName ??
      device?.friendlyName ??
      device?.hostname;
    if (otherName === name) return true;
  }
  return false;
};

/**
 * A synthetic bucket (e.g. favorites) carries its own title and wins over any
 * registry lookup; only real `device:` buckets fall back to directory/device
 * names and finally the unknown label.
 */
export const resolveDeviceGroupName = ({
  deviceName,
  friendlyName,
  hostname,
  title,
  unknownLabel,
}: {
  deviceName?: string | null;
  friendlyName?: string | null;
  hostname?: string | null;
  title?: string | null;
  unknownLabel: string;
}): string => title ?? deviceName ?? friendlyName ?? hostname ?? unknownLabel;

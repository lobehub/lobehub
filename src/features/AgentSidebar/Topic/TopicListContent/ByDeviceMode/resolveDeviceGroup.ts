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
 * on another device altogether.
 */
export const findDeviceTopicDirectory = <T extends DeviceDirectoryLike>(
  directories: T[],
  deviceId?: string,
  fixedDeviceId?: string | null,
): T | undefined =>
  deviceId
    ? directories.find((d) => d.deviceId === deviceId && canStageDraftOn(d, fixedDeviceId))
    : undefined;

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

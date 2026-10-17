interface DeviceDirectoryLike {
  deviceId?: string | null;
  id: string;
  instanceId?: string | null;
}

/**
 * The add-topic affordance on a device group is only safe when the modal can
 * preselect an instance-bound directory on THIS device — its picker lists
 * instance-bound directories only, so without one it silently falls back to
 * another device's directory and the topic would start on the wrong device.
 */
export const findDeviceTopicDirectory = <T extends DeviceDirectoryLike>(
  directories: T[],
  deviceId?: string,
): T | undefined =>
  deviceId ? directories.find((d) => d.deviceId === deviceId && d.instanceId) : undefined;

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

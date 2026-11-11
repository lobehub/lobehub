import { useState } from 'react';

import {
  type ProjectDirectory,
  useProjectDirectories,
  useProjectDirectoryStore,
} from '@/store/projectWorkingDirectory';

/**
 * The project's folders a run on `deviceId` can work in: on that machine,
 * linked to an environment and writable — the same rule a conversation's own
 * device picker applies.
 */
export const directoriesOnDevice = (directories: ProjectDirectory[], deviceId?: string) =>
  deviceId
    ? directories.filter(
        (directory) =>
          directory.deviceId === deviceId &&
          !!directory.instanceId &&
          directory.permission === 'readWrite',
      )
    : [];

/**
 * Where a run goes for a folder just added from a machine's row. The dialog
 * lets the person change the device, so the folder's own device decides, not
 * the row it was opened from: this desktop runs it locally when added from the
 * local row, any other machine as a device.
 */
export const addedFolderTarget = (
  added: { deviceId: string },
  from: 'device' | 'local',
  currentDeviceId?: string,
): { deviceId?: string; target: 'device' | 'local' } =>
  from === 'local' && added.deviceId === currentDeviceId
    ? { target: 'local' }
    : { deviceId: added.deviceId, target: 'device' };

/**
 * The project folder a new conversation on a device starts in: the person's
 * pick while it is still on that device, otherwise the device's first one.
 * Without one the run works wherever the device starts it.
 */
export const useProjectDirectory = (projectId: string, deviceId?: string) => {
  useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId);
  const all = useProjectDirectories(projectId);
  const [pickedId, setPickedId] = useState<string>();
  const onDevice = directoriesOnDevice(all, deviceId);
  const directory = onDevice.find((item) => item.id === pickedId) ?? onDevice[0];

  return {
    directory,
    /** Every usable folder of the project on another machine, for that machine's row. */
    directoriesOn: (id: string) => directoriesOnDevice(all, id),
    setPickedId,
  };
};

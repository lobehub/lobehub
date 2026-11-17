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
 * The project folder a new conversation on a device starts in: the device's
 * first one. Without one the run works wherever the device starts it.
 */
export const useProjectDirectory = (projectId: string, deviceId?: string) => {
  useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId);
  const all = useProjectDirectories(projectId);

  return { directory: directoriesOnDevice(all, deviceId)[0] };
};

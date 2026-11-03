import { deviceSelectors, useDeviceStore } from '@/store/device';

import { filesLocationContextKey, useRememberedFilesLocation } from './useRememberedFilesLocation';

interface FilesPaneLocationParams {
  activeAgentId?: string;
  /** This machine or a bound device can read a filesystem tree. */
  filesystemEnvironmentAvailable: boolean;
  isSandboxExecution: boolean;
  remoteDeviceId?: string;
  /** The instance's directory; the empty string IS the workspace root. */
  sandboxDirectory: string;
  sandboxDirectoryKnown: boolean;
  sandboxInstanceId?: string;
  sandboxTopicId?: string;
  topicId?: string;
  workingDirectory?: string;
}

export interface FilesPaneLocation {
  deviceId?: string;
  directory?: string;
  /** A sandbox tree is read through its own instance, not a device. */
  isSandbox: boolean;
}

/**
 * Which tree the Files tab shows: host + directory.
 *
 * A sandbox resolves from its instance (or, with none picked, from the topic
 * that names the warm session), and is final as soon as the instance directory
 * is known. A device-backed directory is only final once the device list has
 * loaded; until then the tree opens where this conversation last was, so its
 * cached index can paint instead of a home-directory read or a missing tab.
 *
 * A directory is only showable when something can actually read it: the
 * sandbox through its workspace API, a device or this machine through the
 * filesystem. A topic can carry a path persisted on a desktop the web client
 * has no way to reach, and that path is not a tree — it is a string. An
 * instance is what makes a sandbox tree addressable; persistent mode with none
 * picked is the workspace root, which the execution plane can only resolve
 * through a conversation, so that one still waits for the topic.
 */
export const useFilesPaneLocation = ({
  activeAgentId,
  filesystemEnvironmentAvailable,
  isSandboxExecution,
  remoteDeviceId,
  sandboxDirectory,
  sandboxDirectoryKnown,
  sandboxInstanceId,
  sandboxTopicId,
  topicId,
  workingDirectory,
}: FilesPaneLocationParams): FilesPaneLocation => {
  const isSandbox = isSandboxExecution && !!(sandboxInstanceId || sandboxTopicId);
  // The empty string IS the workspace root, so only an unresolved instance
  // withholds the directory.
  const sandboxLiveDirectory = isSandbox
    ? sandboxDirectoryKnown
      ? sandboxDirectory
      : undefined
    : undefined;

  // Not `isDeviceListLoaded`: a hydrated copy already counts as loaded but its
  // `workingDirs` are stale, so treating it as settled would replace the
  // conversation's remembered directory before the server confirms the list.
  const devicesSettled = useDeviceStore(deviceSelectors.isDeviceListConfirmed);
  // A sandbox has its own backend, and without a filesystem environment there
  // is nothing this client can read or mutate: never open a remembered path in
  // either case. A device id is still passed while its directory resolves so a
  // same-host saved tree can paint before the device list answers.
  const canReadFilesystem = !isSandbox && filesystemEnvironmentAvailable;
  const filesLocation = useRememberedFilesLocation(
    canReadFilesystem ? filesLocationContextKey(topicId, activeAgentId) : undefined,
    canReadFilesystem ? { deviceId: remoteDeviceId, directory: workingDirectory } : undefined,
    devicesSettled,
  );

  return {
    deviceId: filesLocation?.deviceId,
    directory: isSandbox ? sandboxLiveDirectory : filesLocation?.directory,
    isSandbox,
  };
};

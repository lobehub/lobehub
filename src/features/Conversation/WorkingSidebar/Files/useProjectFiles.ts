import { isDesktop } from '@lobechat/const';
import type { ProjectFileIndexResult } from '@lobechat/electron-client-ipc';

import { useClientDataSWR } from '@/libs/swr';
import { localFileKeys } from '@/libs/swr/keys';
import { projectFileService } from '@/services/projectFile';

/**
 * Project file tree for a working directory. Transport-agnostic: `fileService`
 * dispatches Electron IPC (local), `device.getProjectFileIndex` RPC (remote,
 * `deviceId` set), or the cloud sandbox's workspace API (`sandboxTopicId` set).
 *
 * Disabled until a directory is available — for the sandbox that is the
 * workspace root, which is the empty string, so its gate is the topic rather
 * than the path. On web without either host there is nothing to read.
 */
export const useProjectFiles = (
  deviceId: string | undefined,
  dirPath: string | undefined,
  sandboxTopicId?: string,
) => {
  const enabled = sandboxTopicId
    ? dirPath !== undefined
    : Boolean(dirPath) && (!!deviceId || isDesktop);
  // The host is part of the identity: the same path on a device and in the
  // sandbox are different trees, and `undefined` already means "this machine".
  const host = sandboxTopicId ? `sandbox:${sandboxTopicId}` : deviceId;
  const key = enabled ? localFileKeys.projectIndex(host, dirPath!) : null;

  return useClientDataSWR<ProjectFileIndexResult | undefined>(
    key,
    () => projectFileService.getProjectFileIndex({ deviceId, sandboxTopicId, scope: dirPath! }),
    {
      focusThrottleInterval: 30 * 1000,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
    },
  );
};

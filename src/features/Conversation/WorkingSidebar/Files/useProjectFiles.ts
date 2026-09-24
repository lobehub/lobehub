import { isDesktop } from '@lobechat/const';
import type { ProjectFileIndexResult } from '@lobechat/electron-client-ipc';

import { useClientDataSWR } from '@/libs/swr';
import { localFileKeys } from '@/libs/swr/keys';
import { projectFileService } from '@/services/projectFile';

/**
 * Project file tree for a working directory. Transport-agnostic: `fileService`
 * dispatches Electron IPC (local), `device.getProjectFileIndex` RPC (remote,
 * `deviceId` set), or the cloud sandbox's workspace API (`sandbox` set).
 *
 * Disabled until a directory is available — for the sandbox that is the
 * workspace root, which is the empty string, so its gate is the source rather
 * than the path. On web without either host there is nothing to read.
 */
export const useProjectFiles = (
  deviceId: string | undefined,
  dirPath: string | undefined,
  sandbox?: { instanceId?: string; topicId?: string },
) => {
  const isSandbox = !!sandbox?.instanceId || !!sandbox?.topicId;
  const enabled = isSandbox ? dirPath !== undefined : Boolean(dirPath) && (!!deviceId || isDesktop);
  // The host is part of the identity: the same path on a device and in the
  // sandbox are different trees, and `undefined` already means "this machine".
  // Keyed by the INSTANCE where there is one — two conversations running the
  // same instance are looking at one tree, and keying by topic would fetch it
  // twice and let one go stale while the other refreshed.
  const host = isSandbox ? `sandbox:${sandbox?.instanceId ?? sandbox?.topicId}` : deviceId;
  const key = enabled ? localFileKeys.projectIndex(host, dirPath!) : null;

  return useClientDataSWR<ProjectFileIndexResult | undefined>(
    key,
    () =>
      projectFileService.getProjectFileIndex({
        deviceId,
        sandboxInstanceId: sandbox?.instanceId,
        sandboxTopicId: sandbox?.topicId,
        scope: dirPath!,
      }),
    {
      focusThrottleInterval: 30 * 1000,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
    },
  );
};

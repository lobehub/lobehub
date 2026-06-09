import { isDesktop } from '@lobechat/const';
import type { ProjectFileIndexResult } from '@lobechat/electron-client-ipc';

import { useClientDataSWR } from '@/libs/swr';
import { projectFileService } from '@/services/projectFile';

/**
 * Project file tree for a working directory. Transport-agnostic: `fileService`
 * dispatches Electron IPC (local) vs `device.getProjectFileIndex` RPC (remote,
 * `deviceId` set). Disabled until a `dirPath` is available, and on web (no
 * `isDesktop`) until a `deviceId` is too.
 */
export const useProjectFiles = (deviceId: string | undefined, dirPath: string | undefined) => {
  const enabled = Boolean(dirPath) && (!!deviceId || isDesktop);
  const key = enabled ? ['project-file-index', deviceId ?? 'local', dirPath] : null;

  return useClientDataSWR<ProjectFileIndexResult | undefined>(
    key,
    () => projectFileService.getProjectFileIndex({ deviceId, scope: dirPath! }),
    {
      focusThrottleInterval: 30 * 1000,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
    },
  );
};

import { isDesktop } from '@lobechat/const';
import type { GitWorkingTreeFiles } from '@lobechat/electron-client-ipc';
import type { GitStatusEntry } from '@pierre/trees';

import { useClientDataSWR } from '@/libs/swr';
import { localFileKeys } from '@/libs/swr/keys';
import { gitService } from '@/services/git';

export const buildGitStatusEntries = (files: GitWorkingTreeFiles | undefined): GitStatusEntry[] => {
  if (!files) return [];

  return [
    ...files.added.map((path) => ({ path, status: 'added' }) as const),
    ...files.modified.map((path) => ({ path, status: 'modified' }) as const),
    ...files.deleted.map((path) => ({ path, status: 'deleted' }) as const),
  ];
};

/**
 * Dirty working-tree files for the git-status overlay. Transport-agnostic via
 * `gitService` (Electron IPC local / `device.*` RPC remote). Disabled until a
 * `dirPath` + `enabled`, and on web until a `deviceId` is present too.
 */
export const useGitWorkingTreeFiles = (
  deviceId: string | undefined,
  dirPath: string | undefined,
  enabled: boolean,
) => {
  const active = (!!deviceId || isDesktop) && !!dirPath && enabled;
  const key = active ? localFileKeys.gitWorkingTreeFiles(deviceId, dirPath!) : null;

  return useClientDataSWR<GitWorkingTreeFiles | undefined>(
    key,
    () => gitService.getGitWorkingTreeFiles({ deviceId, path: dirPath! }),
    {
      focusThrottleInterval: 5 * 1000,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
    },
  );
};

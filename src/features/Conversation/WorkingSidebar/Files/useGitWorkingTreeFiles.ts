import { isDesktop } from '@lobechat/const';
import type { GitWorkingTreeFiles } from '@lobechat/electron-client-ipc';
import type { GitStatusEntry } from '@pierre/trees';
import { useMemo } from 'react';

import {
  gitWorkingTreeFilesResource,
  projectFileActions,
  useProjectFileStore,
} from '@/store/projectFile';

export const buildGitStatusEntries = (files: GitWorkingTreeFiles | undefined): GitStatusEntry[] => {
  if (!files) return [];

  return [
    ...files.added.map((path) => ({ path, status: 'added' }) as const),
    ...files.modified.map((path) => ({ path, status: 'modified' }) as const),
    ...files.deleted.map((path) => ({ path, status: 'deleted' }) as const),
  ];
};

/**
 * Dirty working-tree files for the git-status overlay, read from its replica so
 * a reload paints the last overlay with the tree. Transport-agnostic via
 * `gitService` (Electron IPC local / `device.*` RPC remote). Disabled until a
 * `dirPath` + `enabled`, and on web until a `deviceId` is present too.
 */
export const useGitWorkingTreeFiles = (
  deviceId: string | undefined,
  dirPath: string | undefined,
  enabled: boolean,
  options?: { revalidateOnFocus?: boolean },
) => {
  const active = (!!deviceId || isDesktop) && !!dirPath && enabled;
  const params = useMemo(
    () => (active ? { deviceId, dirPath: dirPath! } : null),
    [active, deviceId, dirPath],
  );
  const data = useProjectFileStore((s) =>
    params ? s.gitWorkingTreeFiles[gitWorkingTreeFilesResource.key(params)] : undefined,
  );
  const { error, isValidating, revalidate } = projectFileActions.useFetchGitWorkingTreeFiles(
    params,
    {
      focusThrottleInterval: 5 * 1000,
      revalidateOnFocus: options?.revalidateOnFocus ?? true,
      shouldRetryOnError: false,
    },
  );

  return { data, error, isValidating, mutate: revalidate };
};

import { isDesktop } from '@lobechat/const';
import type { GitWorkingTreeFiles } from '@lobechat/electron-client-ipc';
import type { GitStatusEntry } from '@pierre/trees';

import { useClientDataSWR } from '@/libs/swr';
import { electronGitService } from '@/services/electron/git';

export const buildGitStatusEntries = (files: GitWorkingTreeFiles | undefined): GitStatusEntry[] => {
  if (!files) return [];

  return [
    ...files.added.map((path) => ({ path, status: 'added' }) as const),
    ...files.modified.map((path) => ({ path, status: 'modified' }) as const),
    ...files.deleted.map((path) => ({ path, status: 'deleted' }) as const),
  ];
};

export const useGitWorkingTreeFiles = (dirPath: string | undefined, enabled: boolean) => {
  const key = isDesktop && dirPath && enabled ? ['git-working-tree-files', dirPath] : null;

  return useClientDataSWR<GitWorkingTreeFiles>(
    key,
    () => electronGitService.getGitWorkingTreeFiles(dirPath!),
    {
      focusThrottleInterval: 5 * 1000,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
    },
  );
};

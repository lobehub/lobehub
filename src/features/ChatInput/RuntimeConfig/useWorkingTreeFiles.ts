import { isDesktop } from '@lobechat/const';

import { useClientDataSWR } from '@/libs/swr';
import { electronGitService } from '@/services/electron/git';

/**
 * Per-file breakdown of the working tree (paths grouped by add/modify/delete).
 * Lazy — only fetched when `enabled` is true (e.g. the popover is open), since
 * it's strictly richer than useWorkingTreeStatus and most users never open the list.
 */
export const useWorkingTreeFiles = (dirPath?: string, enabled?: boolean) => {
  const key = isDesktop && dirPath && enabled ? ['git-working-tree-files', dirPath] : null;

  return useClientDataSWR(key, () => electronGitService.getGitWorkingTreeFiles(dirPath!), {
    focusThrottleInterval: 5 * 1000,
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  });
};

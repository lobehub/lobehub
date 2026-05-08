import { isDesktop } from '@lobechat/const';

import { useClientDataSWR } from '@/libs/swr';
import { electronGitService } from '@/services/electron/git';

/**
 * Working-tree dirty-file breakdown for the current cwd.
 * Always-on (not gated by dropdown open state) so the status bar can show a
 * +N ~M -K badge. Revalidates on window focus, throttled to 5s — git status
 * is local & cheap, but we still don't need sub-second freshness.
 */
export const useWorkingTreeStatus = (dirPath?: string) => {
  const key = isDesktop && dirPath ? ['git-working-tree-status', dirPath] : null;

  return useClientDataSWR(key, () => electronGitService.getGitWorkingTreeStatus(dirPath!), {
    focusThrottleInterval: 5 * 1000,
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  });
};

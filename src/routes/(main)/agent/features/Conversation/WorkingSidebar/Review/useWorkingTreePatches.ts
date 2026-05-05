import { isDesktop } from '@lobechat/const';

import { useClientDataSWR } from '@/libs/swr';
import { electronGitService } from '@/services/electron/git';

/**
 * Single bulk fetch for every dirty file's unified diff patch. Replaces the
 * old N-call-per-file pattern — one IPC, one SWR cache key, the renderer
 * iterates the result. Mirrors the dirty-counts SWR shape (always-on, focus
 * revalidate) so opening the panel doesn't show a loading state when the
 * working tree has already been polled.
 */
export const useWorkingTreePatches = (dirPath?: string) => {
  const key = isDesktop && dirPath ? ['git-working-tree-patches', dirPath] : null;

  return useClientDataSWR(key, () => electronGitService.getGitWorkingTreePatches(dirPath!), {
    focusThrottleInterval: 5 * 1000,
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  });
};

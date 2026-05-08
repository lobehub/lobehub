import { isDesktop } from '@lobechat/const';

import { useClientDataSWR } from '@/libs/swr';
import { electronGitService } from '@/services/electron/git';

/**
 * Ahead/behind commit counts for the current branch vs its upstream tracking ref.
 * Shown as push (↑) / pull (↓) badges in the status bar. Piggybacks a
 * best-effort `git fetch` on every SWR load (including focus revalidation)
 * inside the IPC, so remote updates surface when the user switches back to
 * the window without needing a manual fetch.
 */
export const useGitAheadBehind = (dirPath?: string) => {
  const key = isDesktop && dirPath ? ['git-ahead-behind', dirPath] : null;

  return useClientDataSWR(key, () => electronGitService.getGitAheadBehind(dirPath!), {
    focusThrottleInterval: 5 * 1000,
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  });
};

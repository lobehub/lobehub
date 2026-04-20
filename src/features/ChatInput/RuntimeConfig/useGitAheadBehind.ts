import { isDesktop } from '@lobechat/const';

import { useClientDataSWR } from '@/libs/swr';
import { electronGitService } from '@/services/electron/git';

/**
 * Ahead/behind commit counts for the current branch vs its upstream tracking ref.
 * Shown as push (↑) / pull (↓) badges in the status bar. Network-free: runs
 * `git rev-list` locally against already-fetched refs, so freshness depends on
 * whether the user has fetched recently — we don't auto-fetch here.
 */
export const useGitAheadBehind = (dirPath?: string) => {
  const key = isDesktop && dirPath ? ['git-ahead-behind', dirPath] : null;

  return useClientDataSWR(key, () => electronGitService.getGitAheadBehind(dirPath!), {
    focusThrottleInterval: 5 * 1000,
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  });
};

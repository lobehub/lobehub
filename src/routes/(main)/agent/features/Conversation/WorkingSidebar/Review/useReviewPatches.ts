import { isDesktop } from '@lobechat/const';
import type { GitWorkingTreePatch } from '@lobechat/electron-client-ipc';

import { useClientDataSWR } from '@/libs/swr';
import { electronGitService } from '@/services/electron/git';

export type ReviewMode = 'unstaged' | 'branch';

export interface ReviewPatchesData {
  baseRef?: string;
  headRef?: string;
  mode: ReviewMode;
  patches: GitWorkingTreePatch[];
}

const fetchUnstaged = async (dirPath: string): Promise<ReviewPatchesData> => {
  const result = await electronGitService.getGitWorkingTreePatches(dirPath);
  return { mode: 'unstaged', patches: result.patches };
};

const fetchBranch = async (
  dirPath: string,
  baseRef: string | undefined,
): Promise<ReviewPatchesData> => {
  const result = await electronGitService.getGitBranchDiff({ baseRef, path: dirPath });
  return {
    baseRef: result.baseRef,
    headRef: result.headRef,
    mode: 'branch',
    patches: result.patches,
  };
};

/**
 * Single SWR entry point for the Review panel — `mode` and `baseRef` both
 * participate in the cache key so switching modes or picking a different
 * comparison base swaps cleanly without clobbering other tabs' data.
 *
 * Branch mode runs `git fetch` inside the controller, so we throttle focus
 * revalidation more aggressively there to avoid hitting the network on
 * every window refocus.
 */
export const useReviewPatches = (
  dirPath: string | undefined,
  mode: ReviewMode,
  baseRef?: string,
) => {
  const enabled = isDesktop && Boolean(dirPath);
  const key = enabled ? ['git-review-patches', dirPath, mode, baseRef ?? ''] : null;

  return useClientDataSWR<ReviewPatchesData>(
    key,
    () => (mode === 'branch' ? fetchBranch(dirPath!, baseRef) : fetchUnstaged(dirPath!)),
    {
      focusThrottleInterval: mode === 'branch' ? 30 * 1000 : 5 * 1000,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
    },
  );
};

/**
 * Lazy-loaded list of remote branches under `refs/remotes/origin/*`,
 * keyed by working directory. Used to populate the base-ref picker in the
 * Review panel. Stays disabled until `enabled` flips true so we don't fork
 * a `git for-each-ref` until the user actually opens the dropdown.
 */
export const useGitRemoteBranches = (dirPath: string | undefined, enabled: boolean) => {
  const key = isDesktop && dirPath && enabled ? ['git-remote-branches', dirPath] : null;
  return useClientDataSWR(key, () => electronGitService.listGitRemoteBranches(dirPath!), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
};

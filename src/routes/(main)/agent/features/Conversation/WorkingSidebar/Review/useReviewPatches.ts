import type {
  GitWorkingTreePatch,
  SubmoduleWorkingTreePatches,
} from '@lobechat/electron-client-ipc';

import { useClientDataSWR } from '@/libs/swr';
import { gitService } from '@/services/git';

export type ReviewMode = 'unstaged' | 'branch';

export interface ReviewPatchesData {
  baseRef?: string;
  headRef?: string;
  mode: ReviewMode;
  patches: GitWorkingTreePatch[];
  /**
   * Per-submodule patch groups. Undefined when the parent has no dirty
   * submodules (unstaged) or no submodule pointer differences (branch) — the
   * Review panel keeps its flat single-repo layout in that case. Branch-mode
   * groups carry the submodule's own branch diff against its own origin/HEAD.
   */
  submodules?: SubmoduleWorkingTreePatches[];
}

const fetchUnstaged = async (
  dirPath: string,
  deviceId: string | undefined,
): Promise<ReviewPatchesData> => {
  const result = await gitService.getGitWorkingTreePatches({ deviceId, path: dirPath });
  return { mode: 'unstaged', patches: result?.patches ?? [], submodules: result?.submodules };
};

const fetchBranch = async (
  dirPath: string,
  baseRef: string | undefined,
  deviceId: string | undefined,
): Promise<ReviewPatchesData> => {
  const result = await gitService.getGitBranchDiff({ baseRef, deviceId, path: dirPath });
  return {
    baseRef: result?.baseRef,
    headRef: result?.headRef,
    mode: 'branch',
    patches: result?.patches ?? [],
    submodules: result?.submodules,
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
  deviceId?: string,
) => {
  const enabled = Boolean(dirPath);
  const key = enabled
    ? ['git-review-patches', deviceId ?? 'local', dirPath, mode, baseRef ?? '']
    : null;

  return useClientDataSWR<ReviewPatchesData>(
    key,
    () =>
      mode === 'branch'
        ? fetchBranch(dirPath!, baseRef, deviceId)
        : fetchUnstaged(dirPath!, deviceId),
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
export const useGitRemoteBranches = (
  dirPath: string | undefined,
  enabled: boolean,
  deviceId?: string,
) => {
  const key = dirPath && enabled ? ['git-remote-branches', deviceId ?? 'local', dirPath] : null;
  return useClientDataSWR(
    key,
    () => gitService.listGitRemoteBranches({ deviceId, path: dirPath! }),
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );
};

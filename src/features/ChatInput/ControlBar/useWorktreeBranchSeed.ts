import { generateWorktreeBranchName } from '@lobechat/const';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useFetchGitBranches } from '@/store/device';

export interface WorktreeBranchSeed {
  /** Whether the branch list has settled. No name may be drawn before this. */
  isReady: boolean;
  /** The generated default, `undefined` until the branch list has settled. */
  name?: string;
  /** Draw a different name from the settled list. */
  reroll: () => void;
}

/**
 * The default branch name for a new worktree, drawn against the working
 * directory's full local branch list.
 *
 * Waiting for that list to settle is the point of this hook. Git stores refs as
 * paths, so a branch literally called `wt` blocks the whole `wt/` namespace —
 * and a name drawn from a list that is still in flight reads as "no branches",
 * handing out a ref git is guaranteed to refuse (`cannot lock ref
 * 'refs/heads/wt/…': 'refs/heads/wt' exists`). The modal snapshots the name when
 * it opens, so a late result could never repair that. For the same reason the
 * list persisted from an earlier session does not count as settled: it may miss
 * a branch made since. Shares the branch switcher's replica, so a dropdown
 * opened earlier this session has the list confirmed and the name is ready
 * immediately.
 */
export const useWorktreeBranchSeed = (
  deviceId: string | undefined,
  path: string,
): WorktreeBranchSeed => {
  const { data: branches, error, isConfirmed } = useFetchGitBranches(deviceId, path);

  const excludeBranches = useMemo(() => branches?.map((branch) => branch.name) ?? [], [branches]);
  // A failed read still settles (git refuses a colliding name at create time).
  const isReady = isConfirmed || !!error;

  const [name, setName] = useState<string>();

  // Draw once, and only from a settled list. `current ?? …` keeps a later
  // revalidation from renaming the branch the user is already looking at.
  useEffect(() => {
    if (!isReady) return;
    setName((current) => current ?? generateWorktreeBranchName({ exclude: excludeBranches }));
  }, [excludeBranches, isReady]);

  const reroll = useCallback(() => {
    setName(generateWorktreeBranchName({ exclude: excludeBranches }));
  }, [excludeBranches]);

  return { isReady, name, reroll };
};

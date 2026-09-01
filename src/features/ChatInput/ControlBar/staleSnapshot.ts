import type { DeviceGitLinkedPullRequest, WorkingDirGitState } from '@lobechat/types';

import { getWorkingDirectoryName, isWorktreeCheckout } from '@/helpers/workingDirectoryPath';

export type StaleSnapshotExplanationKey =
  'workingDirectory.staleSnapshot' | 'workingDirectory.staleWorktreeSnapshot';

export interface StaleSnapshotView {
  /** The branch the topic recorded — the snapshot's headline. */
  branch?: string;
  explanation: {
    key: StaleSnapshotExplanationKey;
    values?: { name: string };
  };
  /** True when the recorded checkout was a linked worktree, not the repo itself. */
  isWorktree: boolean;
  pullRequest?: DeviceGitLinkedPullRequest;
  /**
   * Where "go back" lands, and whether it is offered at all. Present only when a
   * worktree override can be dropped — if the recorded SOURCE repo is itself the
   * dead path there is nothing to fall back to, and recovery belongs to the
   * directory picker instead.
   */
  reset?: { name?: string; targetPath: string };
  /** The recorded directory that no longer exists. */
  worktreePath: string;
}

interface ResolveStaleSnapshotParams {
  git: WorkingDirGitState;
  /** The recorded effective directory, i.e. the one that no longer exists. */
  path: string;
  /** The source repo the worktree was linked from, when the topic recorded one. */
  sourcePath?: string;
}

/**
 * What the control bar can still say and do once the directory a topic recorded
 * has been deleted. Split from the component so the decisions — which
 * explanation applies, and whether a way back exists — are testable without
 * rendering a dropdown.
 */
export const resolveStaleSnapshot = ({
  git,
  path,
  sourcePath,
}: ResolveStaleSnapshotParams): StaleSnapshotView => {
  const worktreePath = git.activeWorktree || path;
  const isWorktree = isWorktreeCheckout({ effectivePath: worktreePath, git, sourcePath });
  const worktreeName = isWorktree ? getWorkingDirectoryName(worktreePath) : undefined;
  const canReset = !!sourcePath && worktreePath !== sourcePath;

  return {
    branch: git.branch,
    explanation: worktreeName
      ? { key: 'workingDirectory.staleWorktreeSnapshot', values: { name: worktreeName } }
      : { key: 'workingDirectory.staleSnapshot' },
    isWorktree,
    pullRequest: git.github?.pullRequest ?? undefined,
    ...(canReset
      ? { reset: { name: getWorkingDirectoryName(sourcePath), targetPath: sourcePath! } }
      : {}),
    worktreePath,
  };
};

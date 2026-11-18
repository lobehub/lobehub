import type { WorkingDirConfig } from '@lobechat/types';

/**
 * Output lines that say a command CREATED the branch it moved to:
 *
 * - `git switch -c x` / `git checkout -b x` → `Switched to a new branch 'x'`
 * - `git worktree add -b x …` → `Preparing worktree (new branch 'x')`
 * - Claude Code `EnterWorktree` → `Created worktree at … on branch x.`
 *
 * Only these make the branch the conversation's own; switching to an
 * existing branch never does — someone else's PR may already sit on it.
 */
const CREATED_BRANCH_PATTERNS = [
  /Switched to a new branch ['"]([^'"\n]+)['"]/i,
  /\(new branch ['"]([^'"\n]+)['"]\)/i,
  /^Created worktree at .+? on branch (\S+?)\.? /m,
] as const;

export const parseCreatedBranch = (content?: string): string | undefined => {
  if (!content) return undefined;
  for (const pattern of CREATED_BRANCH_PATTERNS) {
    const branch = pattern.exec(content)?.[1];
    if (branch) return branch;
  }
  return undefined;
};

/**
 * Record `branch` as the conversation's own when the command created it and
 * the topic is now on it (`git.ownBranch`, Better Coding Experience). The run
 * end only asks GitHub for the PR of that branch.
 */
export const applyOwnBranchToConfig = (
  config: WorkingDirConfig | undefined,
  createdBranch: string | undefined,
): WorkingDirConfig | undefined => {
  if (!config?.git || !createdBranch || config.git.branch !== createdBranch) return config;
  if (config.git.ownBranch === createdBranch) return config;
  return { ...config, git: { ...config.git, ownBranch: createdBranch } };
};

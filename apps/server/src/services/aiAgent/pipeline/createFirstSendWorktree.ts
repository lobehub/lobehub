import { WORKTREE_BRANCH_PREFIX } from '@lobechat/const';
import type { WorkingDirConfig } from '@lobechat/types';
import { deriveWorktreePath } from '@lobechat/types';

import { deviceGateway } from '@/server/services/deviceGateway';

import type { WorktreeTurnJob } from './submitWorktreeTurn';

/** Create the checkout selected by a persisted first send, on the selected device. */
export const createFirstSendWorktree = async (
  worktree: WorktreeTurnJob['worktree'] & { branch: string },
  principal: { userId: string; workspaceId?: string },
): Promise<WorkingDirConfig> => {
  const { baseBranch, branch, deviceId, ownerNonce, ownerToken, path, repoType, sourcePath } =
    worktree;
  const scope = { ...principal, deviceId };
  const info = await deviceGateway.queryDeviceSystemInfo(
    scope.userId,
    deviceId,
    scope.workspaceId,
    {
      maxAgeMs: 10 * 60 * 1000,
    },
  );
  const startPoint = baseBranch;
  if (startPoint) {
    // An older device may silently fork from HEAD. Check that it recognizes
    // named refs before issuing the write, just like the interactive picker.
    const comparison = await deviceGateway.gitAheadBehind({ ...scope, branch: startPoint, path });
    if (!comparison) throw new Error('The device could not verify the selected base branch.');
    if (comparison.branch !== startPoint)
      throw new Error('Update the device client to create a worktree from a selected branch.');
  }

  const homeDir = info?.homePath;
  const worktreePath = deriveWorktreePath(homeDir ? sourcePath : path, branch, {
    homeDir,
    stripBranchPrefix: WORKTREE_BRANCH_PREFIX,
  });
  const created = await deviceGateway.addGitWorktree({
    ...scope,
    branch,
    ownerToken,
    path,
    startPoint,
    worktreePath,
  });
  if (
    !created.success ||
    !created.worktreePath ||
    (startPoint && created.startPoint !== startPoint)
  )
    throw new Error(created.error || 'The device did not create the requested worktree.');

  return {
    git: {
      activeWorktree: created.worktreePath,
      autoCreated: true,
      autoCreatedAt: new Date().toISOString(),
      branch,
      isWorktree: true,
      ownBranch: branch,
      ...(ownerToken && created.ownerToken === ownerToken && { ownerNonce, ownerToken }),
    },
    path: sourcePath,
    repoType,
    sessionPath: created.worktreePath,
  };
};

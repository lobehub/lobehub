import { deriveWorktreePath } from '@lobechat/types';

import type { ChannelWorktreeCandidate } from '@/database/repositories/channel';
import { deviceGateway } from '@/server/services/deviceGateway';

/** Same freshness the device router accepts for the home directory. */
const HOME_MAX_AGE_MS = 10 * 60 * 1000;

export type ChannelWorktreeResult =
  { error: string; path?: never } | { error?: never; path: string };

/**
 * Asks the device to cut the candidate's branch from its configured directory's HEAD, under
 * `~/.lobehub/worktrees/`. The path is derived here, never taken from the device. A checkout
 * left by an earlier attempt whose assignment was lost is reused.
 */
export const createChannelWorktree = async (
  candidate: ChannelWorktreeCandidate,
  workspaceId: string | null,
): Promise<ChannelWorktreeResult> => {
  const scope = {
    deviceId: candidate.deviceId,
    userId: candidate.deviceUserId,
    workspaceId: workspaceId ?? undefined,
  };
  const systemInfo = await deviceGateway.queryDeviceSystemInfo(
    scope.userId,
    scope.deviceId,
    scope.workspaceId,
    { maxAgeMs: HOME_MAX_AGE_MS },
  );
  // Without the home directory the path would fall back next to the repo; keep waiting instead.
  if (!systemInfo?.homePath) return { error: 'The device did not report its home directory' };

  const worktreePath = deriveWorktreePath(candidate.sourceDirectory, candidate.branch, {
    homeDir: systemInfo.homePath,
  });
  const added = await deviceGateway.addGitWorktree({
    ...scope,
    branch: candidate.branch,
    path: candidate.sourceDirectory,
    worktreePath,
  });
  if (added.success) return { path: added.worktreePath ?? worktreePath };

  const listed = await deviceGateway.listGitWorktrees({
    ...scope,
    path: candidate.sourceDirectory,
  });
  const existing = listed?.find(
    (worktree) => worktree.path === worktreePath && worktree.branch === candidate.branch,
  );
  if (existing) return { path: existing.path };
  return { error: added.error || 'Could not create a worktree' };
};

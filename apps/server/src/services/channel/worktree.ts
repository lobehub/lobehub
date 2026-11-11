import { deriveWorktreePath } from '@lobechat/types';

import type { ChannelWorktreeCandidate } from '@/database/repositories/channel';
import { deviceGateway } from '@/server/services/deviceGateway';

/** Same freshness the device router accepts for the home directory. */
const HOME_MAX_AGE_MS = 10 * 60 * 1000;

export type ChannelWorktreeResult =
  { error: string; path?: never } | { error?: never; path: string };

const isSep = (ch: string | undefined) => ch === '/' || ch === '\\';

/** `dir` relative to `root` ('' for the root itself), or undefined when it lies outside. */
const offsetIn = (root: string, dir: string) => {
  let end = root.length;
  while (end > 0 && isSep(root[end - 1])) end -= 1;
  const base = root.slice(0, end);
  if (dir === base) return '';
  if (dir.startsWith(base) && isSep(dir[base.length])) return dir.slice(base.length + 1);
};

/** The same place inside another checkout, in that checkout's separator style. */
const inCheckout = (checkout: string, offset: string) => {
  if (!offset) return checkout;
  const sep = checkout.includes('\\') && !checkout.includes('/') ? '\\' : '/';
  return `${checkout}${sep}${offset.replaceAll(/[/\\]/g, sep)}`;
};

/**
 * Asks the device to cut the candidate's branch from its configured directory's HEAD, under
 * `~/.lobehub/worktrees/`. The path is derived here, never taken from the device. A checkout
 * left by an earlier attempt whose assignment was lost is reused. A directory inside the
 * repository keeps its place: the run works in the same subdirectory of the new checkout.
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

  // A repository always lists its own checkout. Asking first keeps a directory outside git from
  // reaching `addGitWorktree`, which creates the target's parent folder before git can refuse.
  const listed = await deviceGateway.listGitWorktrees({
    ...scope,
    path: candidate.sourceDirectory,
  });
  if (!listed?.length) return { error: 'The directory is not a git repository' };

  // The checkout holding the configured directory, and where that directory sits inside it.
  const source = listed.find((worktree) => worktree.current);
  const offset = source && offsetIn(source.path, candidate.sourceDirectory);
  if (!source || offset === undefined)
    return { error: 'Could not locate the directory inside its repository' };

  const worktreePath = deriveWorktreePath(source.path, candidate.branch, {
    homeDir: systemInfo.homePath,
  });
  const existing = listed.find(
    (worktree) => worktree.path === worktreePath && worktree.branch === candidate.branch,
  );
  if (existing) return { path: inCheckout(existing.path, offset) };

  const added = await deviceGateway.addGitWorktree({
    ...scope,
    branch: candidate.branch,
    path: candidate.sourceDirectory,
    worktreePath,
  });
  if (added.success) return { path: inCheckout(added.worktreePath ?? worktreePath, offset) };
  return { error: added.error || 'Could not create a worktree' };
};

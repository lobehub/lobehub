import { isDesktop } from '@lobechat/const';
import type {
  OwnedWorktree,
  OwnedWorktreeCleanupResult,
  OwnedWorktreeCleanupTrigger,
  OwnedWorktreeRestoreResult,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';
import { electronGitService } from '@/services/electron/git';

/**
 * The client half of the automatic cleanup of app-created worktrees
 * (`metadata.ownedWorktrees`, see `apps/server/src/services/worktreeCleanup`).
 *
 * A worktree on a remote device — or on this desktop while it is connected to
 * the gateway — is cleaned and restored by the server over the device RPCs. A
 * worktree on THIS desktop is run here over IPC instead, in the main process:
 * that also covers a desktop with the gateway off (whose cleanups wait as
 * pending) or one that never registered with it (records without a device).
 */

/**
 * This desktop's gateway device id; `undefined` off desktop or when
 * unregistered. Imported lazily: the topic service loads this module, and the
 * electron store must not join its import graph.
 */
const localDeviceId = async () => {
  const { getElectronStoreState } = await import('@/store/electron');
  return getElectronStoreState().resolveGatewayDeviceId();
};

/** Whether the worktree lives on this desktop, where IPC can reach it. */
export const isLocalOwnedWorktree = async (entry: Pick<OwnedWorktree, 'deviceId'>) => {
  if (!isDesktop) return false;
  if (!entry.deviceId) return true;
  return entry.deviceId === (await localDeviceId());
};

const runLocalCleanup = async (
  topicId: string,
  entry: OwnedWorktree,
  trigger: OwnedWorktreeCleanupTrigger,
): Promise<OwnedWorktree | null> => {
  let result: OwnedWorktreeCleanupResult;
  try {
    result = await electronGitService.cleanupOwnedWorktree({
      discard: trigger === 'discarded',
      ownerToken: entry.ownerToken,
      sourcePath: entry.sourcePath,
      worktreePath: entry.path,
    });
  } catch (error) {
    result = { error: (error as Error)?.message || 'Worktree cleanup failed', outcome: 'error' };
  }
  // `unreachable` is a server-side answer only; IPC always reaches the device.
  const outcome = result.outcome === 'unreachable' ? 'error' : result.outcome;
  return lambdaClient.topic.reportOwnedWorktreeCleanup.mutate({
    path: entry.path,
    result: {
      branch: result.branch,
      dirtyFiles: result.dirtyFiles,
      error: result.error,
      outcome,
      unpushedSubmodules: result.unpushedSubmodules,
    },
    topicId,
    trigger,
  });
};

let draining: Promise<number> | undefined;

/**
 * Run the cleanups that wait on this desktop: on startup, and shortly after
 * this desktop archives or trashes a topic (the server marks them pending when
 * it cannot reach the desktop over the gateway). One drain at a time; the
 * server's claim keeps a cleanup from running twice anyway.
 */
export const drainLocalWorktreeCleanups = (): Promise<number> => {
  if (!isDesktop) return Promise.resolve(0);
  draining ??= (async () => {
    try {
      const deviceId = await localDeviceId();
      const claimed = await lambdaClient.topic.claimLocalWorktreeCleanups.mutate({ deviceId });
      for (const { discard, entry, topicId } of claimed) {
        await runLocalCleanup(
          topicId,
          entry,
          discard ? 'discarded' : (entry.cleanup?.trigger ?? 'archived'),
        );
      }
      return claimed.length;
    } catch (error) {
      console.warn('[ownedWorktree] local cleanup drain failed:', error);
      return 0;
    } finally {
      draining = undefined;
    }
  })();
  return draining;
};

/** Give the server's own attempt (after the archive response) time to land first. */
const RETIRE_DRAIN_DELAY_MS = 3000;
let retireDrainTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * This desktop just archived or trashed topics: shortly after, run whatever
 * the server left pending for this desktop (it could not reach it over the
 * gateway). Bursts — a bulk archive — coalesce into one drain.
 */
export const afterTopicsRetired = () => {
  if (!isDesktop) return;
  if (retireDrainTimer) clearTimeout(retireDrainTimer);
  retireDrainTimer = setTimeout(() => {
    retireDrainTimer = undefined;
    void drainLocalWorktreeCleanups();
  }, RETIRE_DRAIN_DELAY_MS);
};

/**
 * "Discard changes and delete": force-remove a kept worktree, uncommitted and
 * ignored files included. The branch is kept.
 */
export const discardOwnedWorktree = async (
  topicId: string,
  entry: OwnedWorktree,
): Promise<OwnedWorktree | null> => {
  if (await isLocalOwnedWorktree(entry)) {
    const claimed = await lambdaClient.topic.discardOwnedWorktree.mutate({
      local: true,
      path: entry.path,
      topicId,
    });
    if (!claimed) return null;
    return runLocalCleanup(topicId, claimed, 'discarded');
  }
  return lambdaClient.topic.discardOwnedWorktree.mutate({ path: entry.path, topicId });
};

/**
 * A server-signed creation receipt for a worktree about to be created for a
 * new topic; `undefined` when the server cannot issue one (the worktree is
 * then cleaned up only when clean, never discarded by force).
 */
export const issueWorktreeReceipt = async () => {
  try {
    return (await lambdaClient.topic.issueWorktreeReceipt.mutate()) ?? undefined;
  } catch (error) {
    console.warn('[ownedWorktree] could not get a worktree receipt:', error);
    return undefined;
  }
};

/** "Keep": never clean this worktree up automatically again. */
export const keepOwnedWorktree = (topicId: string, entry: OwnedWorktree) =>
  lambdaClient.topic.keepOwnedWorktree.mutate({ path: entry.path, topicId });

/**
 * Check a cleaned-up worktree out again at its original path, on its branch,
 * before a restored topic's next turn. A gone branch makes the server move the
 * topic back to its source repository (`branchMissing`).
 */
export const restoreOwnedWorktree = async (
  topicId: string,
  entry: OwnedWorktree,
): Promise<OwnedWorktreeRestoreResult> => {
  const local = await isLocalOwnedWorktree(entry);
  // The server's record decides: a cleanup still running (`busy`), one that
  // never ran (cancelled), or a removed folder to check out again.
  const answer = await lambdaClient.topic.restoreOwnedWorktree.mutate({
    local,
    path: entry.path,
    topicId,
  });
  if (answer.outcome !== 'needsLocal') return answer;

  let result: OwnedWorktreeRestoreResult;
  try {
    result = await electronGitService.restoreOwnedWorktree({
      branch: answer.branch ?? entry.branch ?? '',
      ownerToken: entry.ownerToken,
      sourcePath: entry.sourcePath,
      worktreePath: entry.path,
    });
  } catch (error) {
    return { error: (error as Error)?.message, outcome: 'error' };
  }
  if (result.outcome !== 'branchMissing' && result.outcome !== 'restored') return result;
  return lambdaClient.topic.restoreOwnedWorktree.mutate({
    path: entry.path,
    result: { error: result.error, outcome: result.outcome },
    topicId,
  });
};

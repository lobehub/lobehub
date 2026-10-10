import type { WorkingDirConfigValue } from '@lobechat/types';
import { getWorkingDirEffectivePath, getWorkingDirSourcePath } from '@lobechat/types';

import { gitService } from '@/services/git';
import { deviceSelectors, getDeviceStoreState } from '@/store/device';

export interface ReachableWorkingDirectory {
  /** True when the recorded worktree override was dropped because it is gone. */
  fellBackToSource: boolean;
  /** The directory the run can actually spawn in. */
  path: string | undefined;
}

/**
 * A remote device that is not connected answers a directory read the same way a
 * deleted directory does, so an offline device must never be mistaken for a
 * missing checkout.
 */
const isProbeTargetReachable = (deviceId: string): boolean =>
  !!deviceSelectors.getDeviceById(deviceId)(getDeviceStoreState())?.online;

/**
 * The directory a run can actually spawn in.
 *
 * A topic's cwd is the EFFECTIVE path, so a conversation that entered a linked
 * worktree records that worktree as its checkout. A worktree can be deleted out
 * of band (`git worktree remove`, a cleanup script) while the topic keeps naming
 * it — and the spawn layer deliberately fails loudly on a missing directory
 * instead of auto-creating one — so the run would die where it used to continue
 * in the repo it was linked from.
 *
 * Only a worktree override can go missing this way: the source path is the repo
 * root the user picked and has no such lifecycle. So the read runs only when an
 * override is recorded, and it is the same cheap branch read the status bar
 * already makes — a directory git cannot read answers with no branch.
 *
 * A probe that FAILS says nothing about the checkout (offline device, transport
 * error, unreadable path), so the recorded path is kept and the spawn layer
 * reports the real reason rather than this helper guessing.
 *
 * Read-only by design: the topic keeps its recorded checkout, so the status bar
 * can still show the branch / PR snapshot and offer its one-click reset.
 */
export const resolveReachableWorkingDirectory = async (params: {
  /** The REMOTE device to ask; omit to read this machine directly. */
  deviceId?: string;
  recorded?: WorkingDirConfigValue | null;
}): Promise<ReachableWorkingDirectory> => {
  const effectivePath = getWorkingDirEffectivePath(params.recorded);
  const sourcePath = getWorkingDirSourcePath(params.recorded);

  // Nothing to lose: without a worktree override the effective path IS the source.
  if (!effectivePath || !sourcePath || effectivePath === sourcePath) {
    return { fellBackToSource: false, path: effectivePath };
  }
  if (params.deviceId && !isProbeTargetReachable(params.deviceId)) {
    return { fellBackToSource: false, path: effectivePath };
  }

  try {
    const { branch } = await gitService.getGitBranch({
      deviceId: params.deviceId,
      path: effectivePath,
    });
    if (branch) return { fellBackToSource: false, path: effectivePath };
  } catch {
    return { fellBackToSource: false, path: effectivePath };
  }

  return { fellBackToSource: true, path: sourcePath };
};

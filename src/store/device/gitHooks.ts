import { isDesktop } from '@lobechat/const';
import type {
  DeviceGitAheadBehind,
  DeviceGitWorkingTreeStatus,
  DeviceGitWorktreeListItem,
} from '@lobechat/types';

import { useClientDataSWR } from '@/libs/swr';
import { deviceKeys } from '@/libs/swr/keys';
import { type GitBranchSummary, type GitLinkedPRSummary, gitService } from '@/services/git';

/**
 * Git read hooks for a working directory, transport-agnostic: the fetcher goes
 * through `gitService`, which dispatches Electron IPC (local) vs `device.*` RPC
 * (remote, `deviceId` set). UI only consumes these hooks — same call shape for
 * local and remote. Disabled (no request) until a `path` is available, and on
 * web (no `isDesktop`) until a `deviceId` is too.
 */
const isEnabled = (deviceId: string | undefined, path: string | undefined): path is string =>
  !!path && (!!deviceId || isDesktop);

/**
 * Current branch + detached state. A cheap local git read, so use a short
 * dedupe window (2s): switching the working directory must refetch the branch
 * promptly. A longer window would swallow SWR's key-change revalidation and
 * leave the branch label stuck on the previous directory (only a manual
 * `mutate()` refresh would recover it). 2s still collapses truly concurrent
 * reads of the same dir.
 */
export const useFetchGitBranch = (deviceId: string | undefined, path?: string) =>
  useClientDataSWR<GitBranchSummary>(
    isEnabled(deviceId, path) ? deviceKeys.gitBranch(deviceId ?? 'local', path) : null,
    () => gitService.getGitBranch({ deviceId, path: path! }),
    { dedupingInterval: 2 * 1000, shouldRetryOnError: false },
  );

/**
 * PR linked to the current branch. The lookup spawns `gh pr list` (8s timeout),
 * so keep a long 60s dedupe + 60s focus throttle — unlike the cheap branch read,
 * this must NOT re-run on every remount or directory revisit. Keyed by branch,
 * so a checkout naturally re-keys into a fresh lookup; disabled for non-github
 * repos and detached HEAD (no branch ref to query).
 */
export const useFetchGitLinkedPR = (
  deviceId: string | undefined,
  path: string | undefined,
  branch: string | undefined,
  isGithub = false,
) =>
  useClientDataSWR<GitLinkedPRSummary | undefined>(
    isGithub && branch && isEnabled(deviceId, path)
      ? deviceKeys.gitLinkedPR(deviceId ?? 'local', path, branch)
      : null,
    () => gitService.getLinkedPullRequest({ branch: branch!, deviceId, path: path! }),
    { dedupingInterval: 60 * 1000, focusThrottleInterval: 60 * 1000, shouldRetryOnError: false },
  );

/**
 * Working-tree dirty-file counts. Revalidates on focus (5s throttle) so the
 * +N ~M -K badge tracks edits when the user switches back to the window.
 */
export const useFetchGitWorkingTreeStatus = (deviceId: string | undefined, path?: string) =>
  useClientDataSWR<DeviceGitWorkingTreeStatus | undefined>(
    isEnabled(deviceId, path) ? deviceKeys.gitWorkingTreeStatus(deviceId ?? 'local', path) : null,
    () => gitService.getGitWorkingTreeStatus({ deviceId, path: path! }),
    { focusThrottleInterval: 5 * 1000, revalidateOnFocus: true, shouldRetryOnError: false },
  );

/**
 * Ahead/behind commit counts. Each load piggybacks a best-effort `git fetch`
 * inside the read, so focus revalidation (5s throttle) surfaces remote updates.
 */
export const useFetchGitAheadBehind = (deviceId: string | undefined, path?: string) =>
  useClientDataSWR<DeviceGitAheadBehind | undefined>(
    isEnabled(deviceId, path) ? deviceKeys.gitAheadBehind(deviceId ?? 'local', path) : null,
    () => gitService.getGitAheadBehind({ deviceId, path: path! }),
    { focusThrottleInterval: 5 * 1000, revalidateOnFocus: true, shouldRetryOnError: false },
  );

/**
 * Worktrees attached to the same repository as the current working directory.
 * Revalidates on focus so temp PR worktrees created outside the app appear
 * without restarting the conversation.
 */
export const useFetchGitWorktrees = (deviceId: string | undefined, path?: string) =>
  useClientDataSWR<DeviceGitWorktreeListItem[]>(
    isEnabled(deviceId, path) ? deviceKeys.gitWorktrees(deviceId ?? 'local', path) : null,
    () => gitService.listGitWorktrees({ deviceId, path: path! }),
    { focusThrottleInterval: 5 * 1000, revalidateOnFocus: true, shouldRetryOnError: false },
  );

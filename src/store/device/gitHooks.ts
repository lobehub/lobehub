import { isDesktop } from '@lobechat/const';
import type { DeviceGitAheadBehind, DeviceGitWorkingTreeStatus } from '@lobechat/types';

import { useClientDataSWR } from '@/libs/swr';
import { deviceKeys } from '@/libs/swr/keys';
import { type GitInfo, gitService } from '@/services/git';

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
 * Branch + linked PR. PR lookup spawns `gh`, so dedupe + throttle focus
 * revalidation to 60s to avoid spamming the CLI.
 */
export const useFetchGitInfo = (deviceId: string | undefined, path?: string, isGithub = false) =>
  useClientDataSWR<GitInfo>(
    isEnabled(deviceId, path) ? deviceKeys.gitInfo(deviceId ?? 'local', path, isGithub) : null,
    () => gitService.getGitInfo({ deviceId, isGithub, path: path! }),
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

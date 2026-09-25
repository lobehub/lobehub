import path from 'node:path';

import type { WorkingDirConfig, WorkingDirConfigValue } from '@lobechat/types';
import { getWorkingDirEffectivePath } from '@lobechat/types';

const toWorkingDirConfig = (
  value: WorkingDirConfigValue | null | undefined,
): WorkingDirConfig | undefined => {
  if (!value) return;
  return typeof value === 'string' ? { path: value } : value;
};

/**
 * A topic's pinned cwd is a bare path recorded on one machine, so it only
 * holds on that machine. `topicDeviceId` (`topic.metadata.boundDeviceId`) names
 * it when known; for older topics without one, a Windows drive/UNC path on a
 * non-Windows device is the tell-tale that the pin came from elsewhere.
 */
const topicPinFitsDevice = (
  pinnedPath: string | undefined,
  params: { deviceId?: string; devicePlatform?: string | null; topicDeviceId?: string },
): boolean => {
  if (params.deviceId && params.topicDeviceId && params.deviceId !== params.topicDeviceId)
    return false;
  if (
    pinnedPath &&
    params.devicePlatform &&
    params.devicePlatform !== 'win32' &&
    path.win32.isAbsolute(pinnedPath) &&
    !path.posix.isAbsolute(pinnedPath)
  )
    return false;
  return true;
};

/**
 * Resolve the working directory for a device-bound run.
 *
 * Single source of truth for cwd precedence, shared by every server site that
 * needs it (hetero dispatch, workspace-init scan, new-topic backfill) so they
 * cannot drift. Mirrors the client picker's write rules in
 * `useCommitWorkingDirectory`:
 *
 *   topic override > brand-new-topic initial metadata > agent's per-device
 *   choice > device default.
 *
 * - `topicWorkingDirectory` — an existing topic's pinned cwd
 *   (`topic.metadata.workingDirectory`); wins once a conversation exists, but
 *   only on the device it was pinned on (`topicDeviceId` / `devicePlatform`).
 *   Another device — a sub-agent, or the agent moved to a new machine — skips
 *   it and resolves its own directory from the sources below.
 * - `initialWorkingDirectory` — only populated for a brand-new topic
 *   (`appContext.initialTopicMetadata.workingDirectory`, e.g. the primary repo).
 * - `workingDirByDevice[deviceId]` — the agent's per-device pick from the picker
 *   when no topic existed yet.
 * - `deviceDefaultCwd` — the device's user-configured default.
 */
export const resolveDeviceWorkingDirectoryConfig = (params: {
  deviceDefaultCwd?: string | null;
  deviceId?: string;
  devicePlatform?: string | null;
  initialWorkingDirectory?: string;
  initialWorkingDirectoryConfig?: WorkingDirConfig;
  topicDeviceId?: string;
  topicWorkingDirectory?: string;
  topicWorkingDirectoryConfig?: WorkingDirConfig;
  workingDirByDevice?: Record<string, WorkingDirConfigValue> | null;
}): WorkingDirConfig | undefined => {
  const topicPin =
    params.topicWorkingDirectoryConfig ??
    (params.topicWorkingDirectory ? { path: params.topicWorkingDirectory } : undefined);
  if (topicPin && topicPinFitsDevice(topicPin.path, params)) return topicPin;
  if (params.initialWorkingDirectoryConfig) return params.initialWorkingDirectoryConfig;
  if (params.initialWorkingDirectory) return { path: params.initialWorkingDirectory };

  const agentChoice = toWorkingDirConfig(
    params.deviceId ? params.workingDirByDevice?.[params.deviceId] : undefined,
  );
  if (agentChoice) return agentChoice;
  if (params.deviceDefaultCwd) return { path: params.deviceDefaultCwd };
};

export const resolveDeviceWorkingDirectory = (
  params: Parameters<typeof resolveDeviceWorkingDirectoryConfig>[0],
): string | undefined => {
  const config = resolveDeviceWorkingDirectoryConfig(params);
  return getWorkingDirEffectivePath(config);
};

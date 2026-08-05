import type { WorkingDirConfig, WorkingDirConfigValue } from '@lobechat/types';
import { getWorkingDirEffectivePath } from '@lobechat/types';

const toWorkingDirConfig = (
  value: WorkingDirConfigValue | null | undefined,
): WorkingDirConfig | undefined => {
  if (!value) return;
  return typeof value === 'string' ? { path: value } : value;
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
 *   (`topic.metadata.workingDirectory`); always wins once a conversation exists.
 * - `initialWorkingDirectory` — only populated for a brand-new topic
 *   (`appContext.initialTopicMetadata.workingDirectory`, e.g. the primary repo).
 * - `workingDirByDevice[deviceId]` — the agent's per-device pick from the picker
 *   when no topic existed yet.
 * - `deviceDefaultCwd` — the device's user-configured default.
 */
export const resolveDeviceWorkingDirectoryConfig = (params: {
  deviceDefaultCwd?: string | null;
  deviceId?: string;
  initialWorkingDirectory?: string;
  initialWorkingDirectoryConfig?: WorkingDirConfig;
  topicWorkingDirectory?: string;
  topicWorkingDirectoryConfig?: WorkingDirConfig;
  workingDirByDevice?: Record<string, WorkingDirConfigValue> | null;
}): WorkingDirConfig | undefined => {
  if (params.topicWorkingDirectoryConfig) return params.topicWorkingDirectoryConfig;
  if (params.topicWorkingDirectory) return { path: params.topicWorkingDirectory };
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

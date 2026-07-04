import type { WorkingDirConfigValue } from '@lobechat/types';
import { getWorkingDirEffectivePath } from '@lobechat/types';

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
export const resolveDeviceWorkingDirectory = (params: {
  deviceDefaultCwd?: string | null;
  deviceId?: string;
  initialWorkingDirectory?: string;
  topicWorkingDirectory?: string;
  workingDirByDevice?: Record<string, WorkingDirConfigValue> | null;
}): string | undefined =>
  params.topicWorkingDirectory ||
  params.initialWorkingDirectory ||
  getWorkingDirEffectivePath(
    params.deviceId ? params.workingDirByDevice?.[params.deviceId] : undefined,
  ) ||
  params.deviceDefaultCwd ||
  undefined;

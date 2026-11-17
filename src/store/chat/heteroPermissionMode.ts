import {
  type PermissionModeReportData,
  permissionModeReportPatch,
} from '@lobechat/heterogeneous-agents/claudeCodePermission/shared';
import type {
  ChatTopicMetadata,
  HeteroPermissionMode,
  HeteroPermissionModeFallback,
} from '@lobechat/types';
import { DEFAULT_HETERO_PERMISSION_MODE, isHeteroPermissionMode } from '@lobechat/types';

import { topicSelectors } from '@/store/chat/selectors';
import type { ChatStore } from '@/store/chat/store';
import { getUserStoreState } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

/*
 * Claude Code permission modes (Better Coding Experience lab), renderer side.
 *
 * A topic's mode lives in `metadata.heteroPermissionMode`: the composer chip
 * writes it, every run starts in it, and Claude Code's own reports (leaving
 * plan mode) are written back. A topic that does not exist yet takes the mode
 * the chip shows for its directory, handed over at creation (see
 * `takePendingHeteroPermissionMode`).
 */

/** Whether runs of `agentType` have permission modes: Claude Code with the lab on. */
export const hasHeteroPermissionModes = (agentType: string | undefined): boolean =>
  agentType === 'claude-code' &&
  labPreferSelectors.enableBetterCodingExperience(getUserStoreState());

/** The mode a topic's runs start in; the default when it has none. */
export const readTopicPermissionMode = (
  metadata: ChatTopicMetadata | null | undefined,
): HeteroPermissionMode => {
  const mode = metadata?.heteroPermissionMode;
  return isHeteroPermissionMode(mode) ? mode : DEFAULT_HETERO_PERMISSION_MODE;
};

/** The mode a local run starts in, or undefined to allow every action (lab off, other agents). */
export const resolveRunPermissionMode = (
  agentType: string | undefined,
  metadata: ChatTopicMetadata | null | undefined,
): HeteroPermissionMode | undefined =>
  hasHeteroPermissionModes(agentType) ? readTopicPermissionMode(metadata) : undefined;

/** The new-topic chip's mode per agent, while the composer shows it. */
const pendingModes = new Map<string, HeteroPermissionMode>();

/** The composer's new-topic chip shows `mode` for `agentId` (undefined: it is gone). */
export const setPendingHeteroPermissionMode = (
  agentId: string,
  mode: HeteroPermissionMode | undefined,
): void => {
  if (mode) pendingModes.set(agentId, mode);
  else pendingModes.delete(agentId);
};

/**
 * Metadata a new Claude Code topic is born with: the mode its chip showed.
 * Empty when no chip showed one (the lab off, another agent, a send from
 * elsewhere), so the topic starts in the default.
 */
export const pendingHeteroPermissionModeMetadata = (
  agentId: string,
  agentType: string | undefined,
): Pick<ChatTopicMetadata, 'heteroPermissionMode'> => {
  const mode = pendingModes.get(agentId);
  return mode && hasHeteroPermissionModes(agentType) ? { heteroPermissionMode: mode } : {};
};

/**
 * Write the mode Claude Code reports onto the topic, so the chip shows it and
 * the next run starts in it. `persist: false` when the server already wrote it
 * (a run hosted by `lh hetero exec`); the store just follows.
 */
export const applyPermissionModeReport = async (
  get: () => ChatStore,
  topicId: string | null | undefined,
  report: Pick<PermissionModeReportData, 'fallback' | 'permissionMode'>,
  { persist }: { persist: boolean },
): Promise<void> => {
  if (!topicId) return;
  const patch = permissionModeReportPatch(report);
  const topic = topicSelectors.getTopicById(topicId)(get());
  const current = topic?.metadata;
  if (
    (!patch.heteroPermissionMode || current?.heteroPermissionMode === patch.heteroPermissionMode) &&
    (current?.heteroPermissionModeFallback ?? null) === patch.heteroPermissionModeFallback
  ) {
    return;
  }

  if (persist) {
    await get().updateTopicMetadata(topicId, patch);
    return;
  }
  if (!topic) return;
  get().internal_dispatchTopic({
    id: topicId,
    type: 'updateTopic',
    value: { metadata: { ...topic.metadata, ...patch } },
  });
};

/**
 * Record why a topic's last run was not in its picked mode (an outdated `lh`
 * on the device). The pick stays, so the topic gets it once the device can.
 */
export const markPermissionModeFallback = async (
  get: () => ChatStore,
  topicId: string | null | undefined,
  fallback: HeteroPermissionModeFallback,
): Promise<void> => {
  if (!topicId) return;
  await get().updateTopicMetadata(topicId, { heteroPermissionModeFallback: fallback });
};

/** The mode a fallback runs in instead of the picked one. */
export const effectivePermissionMode = (
  mode: HeteroPermissionMode,
  fallback: HeteroPermissionModeFallback | null | undefined,
): HeteroPermissionMode =>
  fallback === 'outdatedCli'
    ? 'bypassPermissions'
    : fallback === 'root' && mode === 'bypassPermissions'
      ? 'acceptEdits'
      : mode;

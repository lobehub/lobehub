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
  // Claude Code said which mode it is in: the chip no longer has to guess.
  clearSwitchUnapplied(topicId);
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

/** Switches the permission mode of a run hosted in this window (desktop IPC). */
/** Resolves with the mode the session took, when the host says. */
export type LocalPermissionModeSwitcher = (
  mode: HeteroPermissionMode,
) => Promise<HeteroPermissionMode | void>;

const localSwitchers = new Map<string, LocalPermissionModeSwitcher>();

/**
 * Register how to switch the mode of a topic's local run, for as long as its
 * session lives (the chip switches mid-run through it).
 *
 * @returns Unregister; a no-op once a newer run of the topic registered.
 */
export const registerLocalPermissionModeSwitcher = (
  topicId: string | null | undefined,
  switcher: LocalPermissionModeSwitcher,
): (() => void) => {
  if (!topicId) return () => {};
  localSwitchers.set(topicId, switcher);
  return () => {
    if (localSwitchers.get(topicId) === switcher) localSwitchers.delete(topicId);
  };
};

export const getLocalPermissionModeSwitcher = (
  topicId: string,
): LocalPermissionModeSwitcher | undefined => localSwitchers.get(topicId);

/**
 * The server operation of a topic's run hosted by `lh hetero exec`, which a
 * mid-run switch is sent to: the live Gateway operation this window started
 * (its server id arrives with the first response), else the topic's persisted
 * `runningOperation` (a run picked up after a reload).
 */
export const findRunningServerOperationId = (
  state: Pick<ChatStore, 'operations'>,
  topicId: string,
  metadata: ChatTopicMetadata | null | undefined,
): string | undefined => {
  for (const operation of Object.values(state.operations ?? {})) {
    if (
      operation.type !== 'execServerAgentRuntime' ||
      operation.status !== 'running' ||
      operation.context.topicId !== topicId ||
      !operation.metadata.serverOperationId
    ) {
      continue;
    }
    const parent = operation.parentOperationId
      ? state.operations[operation.parentOperationId]
      : undefined;
    if (parent?.type === 'execServerAgentRuntime') continue;
    return operation.metadata.serverOperationId;
  }
  return metadata?.runningOperation?.operationId;
};

/**
 * Topics whose running session did not take the mode the user just picked
 * (the device's `lh` cannot switch mid-run, or the request failed): the mode
 * that run is still in. The pick is saved for the next run; until Claude Code
 * reports a mode again, the chip shows this one and says so.
 */
const unappliedSwitches = new Map<string, HeteroPermissionMode>();
const unappliedListeners = new Set<() => void>();

const notifyUnapplied = () => {
  for (const listener of unappliedListeners) listener();
};

export const markSwitchUnapplied = (topicId: string, liveMode: HeteroPermissionMode): void => {
  unappliedSwitches.set(topicId, liveMode);
  notifyUnapplied();
};

export const clearSwitchUnapplied = (topicId: string | null | undefined): void => {
  if (!topicId || !unappliedSwitches.delete(topicId)) return;
  notifyUnapplied();
};

export const getUnappliedLiveMode = (
  topicId: string | null | undefined,
): HeteroPermissionMode | undefined => (topicId ? unappliedSwitches.get(topicId) : undefined);

export const subscribeUnappliedSwitches = (listener: () => void): (() => void) => {
  unappliedListeners.add(listener);
  return () => unappliedListeners.delete(listener);
};

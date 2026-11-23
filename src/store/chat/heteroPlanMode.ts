import {
  CODEX_PROPOSED_PLAN_API_NAME,
  type CollaborationModeReportData,
  collaborationModeReportPatch,
} from '@lobechat/heterogeneous-agents/codexPlanMode';
import type { ChatTopicMetadata, CodexCollaborationMode } from '@lobechat/types';
import { codexCollaborationModeOf } from '@lobechat/types';

import { topicSelectors } from '@/store/chat/selectors';
import type { ChatStore } from '@/store/chat/store';
import { getUserStoreState } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

/*
 * Codex Plan switch (Better Coding Experience lab), renderer side.
 *
 * A topic's switch lives in `metadata.heteroPlanMode`: absent until the user
 * first turns it on, so a topic that never did sends no collaboration mode at
 * all. Every native Codex turn of a topic that did sends `plan` or `default`.
 * Codex keeps the mode on the thread: only the user turns Plan off (the
 * switch, or Execute plan under a plan).
 */

/** Whether the Plan switch applies at all: both labs on (it needs the native app-server). */
export const isCodexPlanModeEnabled = (): boolean => {
  const state = getUserStoreState();
  return (
    labPreferSelectors.enableBetterCodingExperience(state) &&
    labPreferSelectors.enableCodexAppServer(state)
  );
};

/**
 * The collaboration mode a local Codex run sends, or undefined to send none
 * (another agent, a topic that never turned Plan on, a lab off).
 */
export const resolveRunCollaborationMode = (
  agentType: string | undefined,
  metadata: ChatTopicMetadata | null | undefined,
): CodexCollaborationMode | undefined =>
  agentType === 'codex' && isCodexPlanModeEnabled()
    ? codexCollaborationModeOf(metadata?.heteroPlanMode)
    : undefined;

/** The new-topic switch per agent, while the composer shows it on or flipped. */
const pendingSwitches = new Map<string, boolean>();

/** The composer's new-topic switch for `agentId` (undefined: nothing to hand over). */
export const setPendingHeteroPlanMode = (agentId: string, enabled: boolean | undefined): void => {
  if (enabled === undefined) pendingSwitches.delete(agentId);
  else pendingSwitches.set(agentId, enabled);
};

/** Metadata a new Codex topic is born with: the switch its composer showed. */
export const pendingHeteroPlanModeMetadata = (
  agentId: string,
  agentType: string | undefined,
): Pick<ChatTopicMetadata, 'heteroPlanMode'> => {
  const enabled = pendingSwitches.get(agentId);
  return enabled !== undefined && agentType === 'codex' && isCodexPlanModeEnabled()
    ? { heteroPlanMode: enabled }
    : {};
};

/**
 * Write a collaboration-mode report onto the topic. `persist: false` when the
 * server already wrote it (a run hosted by `lh hetero exec`); the store follows.
 */
export const applyCollaborationModeReport = async (
  get: () => ChatStore,
  topicId: string | null | undefined,
  report: Pick<CollaborationModeReportData, 'collaborationMode' | 'requested'>,
  { persist }: { persist: boolean },
): Promise<void> => {
  if (!topicId) return;
  const patch = collaborationModeReportPatch(report);
  const topic = topicSelectors.getTopicById(topicId)(get());
  const current = topic?.metadata;
  const changed = (Object.keys(patch) as (keyof typeof patch)[]).some(
    (key) => (current?.[key] ?? null) !== (patch[key] ?? null),
  );
  if (!changed) return;
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

/** Switches the collaboration mode of a run hosted in this window (desktop IPC). */
export type LocalCollaborationModeSwitcher = (mode: CodexCollaborationMode) => Promise<void>;

const localSwitchers = new Map<string, LocalCollaborationModeSwitcher>();

/**
 * Register how to flip the Plan switch of a topic's local run, for as long as
 * its session lives.
 *
 * @returns Unregister; a no-op once a newer run of the topic registered.
 */
export const registerLocalCollaborationModeSwitcher = (
  topicId: string | null | undefined,
  switcher: LocalCollaborationModeSwitcher,
): (() => void) => {
  if (!topicId) return () => {};
  localSwitchers.set(topicId, switcher);
  return () => {
    if (localSwitchers.get(topicId) === switcher) localSwitchers.delete(topicId);
  };
};

export const getLocalCollaborationModeSwitcher = (
  topicId: string,
): LocalCollaborationModeSwitcher | undefined => localSwitchers.get(topicId);

/** The parts of a conversation message the plan decision looks at. */
interface DecisionMessage {
  plugin?: { apiName?: string; identifier?: string } | null;
  role: string;
  tool_call_id?: string | null;
}

/**
 * Whether the "Execute plan / Keep discussing" buttons show under a Codex plan.
 *
 * Only under the latest plan of a topic whose Plan switch is still on, once
 * the topic is idle, and until the user answered (a dismissal for this plan,
 * or any message of theirs after it). Nothing waits on Codex here: its turn
 * already ended, so the buttons never hold the run open.
 */
export const shouldShowCodexPlanDecision = ({
  messages,
  metadata,
  running,
  toolCallId,
}: {
  messages: readonly DecisionMessage[];
  metadata: ChatTopicMetadata | null | undefined;
  running: boolean;
  toolCallId: string | undefined;
}): boolean => {
  if (!toolCallId || running || !isCodexPlanModeEnabled()) return false;
  if (metadata?.heteroPlanMode !== true) return false;
  if (metadata.codexPlanDecision?.itemId === toolCallId && metadata.codexPlanDecision.dismissed) {
    return false;
  }
  const index = messages.findIndex((m) => m.role === 'tool' && m.tool_call_id === toolCallId);
  if (index < 0) return false;
  return !messages
    .slice(index + 1)
    .some(
      (m) =>
        m.role === 'user' ||
        (m.role === 'tool' &&
          m.plugin?.identifier === 'codex' &&
          m.plugin.apiName === CODEX_PROPOSED_PLAN_API_NAME),
    );
};

interface PlanDecisionDeps {
  toolCallId: string;
  topicId: string;
  updateTopicMetadata: (
    topicId: string,
    patch: Pick<ChatTopicMetadata, 'codexPlanDecision' | 'heteroPlanMode'>,
  ) => Promise<unknown>;
}

/**
 * "Execute plan": turn Plan off and put the buttons away, then ask Codex to
 * carry the plan out. The write lands first: the run the message dispatches
 * reads the topic (on the server for `lh` runs) and must send `default`. The
 * message is a turn of its own, so a draft in the composer stays there.
 */
export const executeCodexPlan = async ({
  message,
  sendMessage,
  toolCallId,
  topicId,
  updateTopicMetadata,
}: PlanDecisionDeps & {
  message: string;
  sendMessage: (params: { message: string; preserveComposer: true }) => Promise<unknown>;
}): Promise<void> => {
  await updateTopicMetadata(topicId, {
    codexPlanDecision: { dismissed: true, itemId: toolCallId },
    heteroPlanMode: false,
  });
  await sendMessage({ message, preserveComposer: true });
};

/** "Keep discussing": put the buttons away; Plan stays on. */
export const dismissCodexPlan = async ({
  toolCallId,
  topicId,
  updateTopicMetadata,
}: PlanDecisionDeps): Promise<void> => {
  await updateTopicMetadata(topicId, {
    codexPlanDecision: { dismissed: true, itemId: toolCallId },
  });
};

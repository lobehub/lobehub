import type { ChatTopicMetadata } from '@lobechat/types';
import {
  resolveHeterogeneousProviderTopicModel,
  resolveHeterogeneousTopicRuntimeSnapshot,
} from '@lobechat/types';

import { resolveAgentConfig } from '@/services/chat/mecha';
import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { getAiInfraStoreState } from '@/store/aiInfra';
import { aiModelSelectors } from '@/store/aiInfra/slices/aiModel/selectors';
import { pendingHeteroPermissionModeMetadata } from '@/store/chat/heteroPermissionMode';
import { pendingHeteroPlanModeMetadata } from '@/store/chat/heteroPlanMode';

/**
 * Snapshot the given agent's current model/provider so a newly created topic
 * remembers which model it was started with. The snapshot is persisted to the
 * top-level `topics.model`/`provider` columns (the config source of truth) —
 * subsequent model switches while the topic is active overwrite those columns
 * (see `updateTopicModel`), and generation + ChatInput display resolve
 * from them (see `topicSelectors.getTopicModelById`).
 */
export const snapshotAgentModel = (
  agentId?: string | null,
): { model?: string; provider?: string } => {
  if (!agentId) return {};

  const agentState = getAgentStoreState();

  // Heterogeneous topics snapshot the selector value that will be passed to the
  // CLI (including `default`) or the bound API model. This keeps a topic stable
  // when the Agent default changes later.
  const heterogeneousProvider =
    agentByIdSelectors.getAgencyConfigById(agentId)(agentState)?.heterogeneousProvider;
  if (heterogeneousProvider) {
    return (
      resolveHeterogeneousProviderTopicModel(heterogeneousProvider) ??
      (heterogeneousProvider.type ? { provider: heterogeneousProvider.type } : {})
    );
  }

  // Non-hetero: snapshot the model an unpinned run would use, which is the
  // caller's own pick for a public Workspace Agent in member-selection mode
  // (`workspaceUserPreference.agentModelOverrides`), else the agent default.
  // Reading the shared row here pinned every new topic of a Workspace member
  // back to the shared default, discarding the model they had just picked.
  // Snapshotting the defaulted value is intended: the topic keeps the model it
  // started with even after the agent default later changes.
  const { agentConfig } = resolveAgentConfig({ agentId });
  return {
    model: agentConfig?.model || agentByIdSelectors.getAgentModelById(agentId)(agentState),
    provider:
      agentConfig?.provider || agentByIdSelectors.getAgentModelProviderById(agentId)(agentState),
  };
};

export type TopicReasoningSnapshot = Pick<
  ChatTopicMetadata,
  'heteroEffort' | 'heteroPermissionMode' | 'heteroPlanMode' | 'heteroSpeed' | 'reasoningConfig'
>;

/**
 * Snapshot the reasoning effort that goes with {@link snapshotAgentModel} so a
 * new topic also remembers the effort it was started with (persisted to
 * `topics.metadata.reasoningConfig` / `heteroEffort`, see `ChatTopicMetadata`).
 *
 * - Heterogeneous agents pin the agent's `heterogeneousProvider.effort` and
 *   resolved speed.
 * - API models pin the user's model-instance reasoning config for the
 *   snapshotted model — an empty object when nothing is saved, which pins the
 *   topic to the model's own defaults. Wait for the saved config before
 *   snapshotting; if loading fails, retain the generation fallback instead
 *   of freezing an unverified default.
 *
 * Returns undefined when there is nothing to pin, so callers can spread it
 * into `metadata` without leaving empty keys behind.
 */
export const snapshotAgentReasoning = async (
  agentId: string | null | undefined,
  modelSnapshot: { model?: string; provider?: string },
): Promise<TopicReasoningSnapshot | undefined> => {
  if (!agentId) return undefined;

  const heterogeneousProvider =
    agentByIdSelectors.getAgencyConfigById(agentId)(getAgentStoreState())?.heterogeneousProvider;
  if (heterogeneousProvider) {
    const snapshot = {
      ...resolveHeterogeneousTopicRuntimeSnapshot(heterogeneousProvider),
      // The Claude Code permission mode / Codex Plan switch the new-topic composer showed.
      ...pendingHeteroPermissionModeMetadata(agentId, heterogeneousProvider.type),
      ...pendingHeteroPlanModeMetadata(agentId, heterogeneousProvider.type),
    };
    return Object.keys(snapshot).length === 0 ? undefined : snapshot;
  }

  const { model, provider } = modelSnapshot;
  if (!model || !provider) return undefined;

  /** Creation must settle the saved config before persistence, including a first send after reload. */
  await getAiInfraStoreState().ensureModelReasoningConfig(model, provider);
  const aiInfraState = getAiInfraStoreState();
  if (!aiModelSelectors.isModelHasReasoningExtendParams(model, provider)(aiInfraState)) return;
  if (!aiModelSelectors.isModelReasoningConfigLoaded(model, provider)(aiInfraState)) return;

  return {
    reasoningConfig: aiModelSelectors.modelReasoningConfig(model, provider)(aiInfraState) ?? {},
  };
};

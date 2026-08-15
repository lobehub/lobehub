import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

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

  // Heterogeneous agents (Claude Code, Codex, …) delegate model selection to an
  // external CLI, so neither agent column can be snapshotted: `model` is
  // deliberately left unset at creation (the CLI reports the real model per run
  // and it is backfilled onto the messages), and `provider` is NULL on every
  // agent created before the runtime type started being stamped there. Both
  // model/provider selectors below substitute the platform chat defaults for a
  // blank, which would pin `<default provider>/<default model>` onto a topic
  // that never ran either. Pin the runtime type — the one fact we do know — and
  // leave `model` to the per-run backfill.
  const heterogeneousProvider =
    agentByIdSelectors.getAgencyConfigById(agentId)(agentState)?.heterogeneousProvider;
  if (heterogeneousProvider) {
    return heterogeneousProvider.type ? { provider: heterogeneousProvider.type } : {};
  }

  // Non-hetero: the effective model IS the agent default when nothing is pinned,
  // so snapshotting the defaulted value is intended — it keeps the topic on the
  // model it started with even after the agent default later changes.
  return {
    model: agentByIdSelectors.getAgentModelById(agentId)(agentState),
    provider: agentByIdSelectors.getAgentModelProviderById(agentId)(agentState),
  };
};

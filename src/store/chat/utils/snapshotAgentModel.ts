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
  const model = agentByIdSelectors.getAgentModelById(agentId)(agentState);
  if (!model) return {};

  return { model, provider: agentByIdSelectors.getAgentModelProviderById(agentId)(agentState) };
};

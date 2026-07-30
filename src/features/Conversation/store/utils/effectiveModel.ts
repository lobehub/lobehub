import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

/**
 * Resolve the model a generation in this conversation would actually use.
 *
 * A topic snapshots the model it was created with and remembers switches made
 * while active (top-level `topics.model` column, read via `getTopicModelById`),
 * overriding the agent default — mirroring the `modelResolution` chain in
 * `streamingExecutor`. UI guards keyed on model capabilities (e.g. the Claude
 * prefill checks) must resolve the same effective model, not the agent default.
 */
export const getEffectiveConversationModel = (context: {
  agentId?: string | null;
  topicId?: string | null;
}): string | undefined => {
  // Guard on topicDataMap: this runs inside UI actions whose tests build
  // partially-mocked chat stores, and a capability guard must never throw.
  const chatState = useChatStore.getState();
  const topicModel =
    context.topicId && chatState.topicDataMap
      ? topicSelectors.getTopicModelById(context.topicId)(chatState)?.model
      : undefined;
  if (topicModel) return topicModel;

  return context.agentId
    ? agentSelectors.getAgentConfigById(context.agentId)(getAgentStoreState())?.model
    : undefined;
};

'use client';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
// Import from the topic slice directly (not the `@/store/chat/selectors` barrel)
// to keep this hook's import graph small — it is pulled into many ChatInput
// controls, and the barrel drags in unrelated slice selectors.
import { topicSelectors } from '@/store/chat/slices/topic/selectors';

import { useTopicId } from './useTopicId';

interface ModelAndProvider {
  model: string;
  provider: string;
}

/**
 * The model pinned to this composer's own topic (see `useTopicId`), never the
 * global active topic's: a page copilot embedded beside another chat has
 * `topicId: null` and must not pick up the outer chat's pin.
 *
 * Also the single place the composer loads its topic by id. A topic that never
 * reaches the loaded lists (a document's chat panel runs on a
 * `trigger='document'` system topic, a goal's supervision topic is excluded from
 * the sidebar) still has a persisted pin and summary the run uses, and not every
 * route mounts `useFetchActiveTopicDetail`. Doing it here, rather than in a
 * leaf like the token tag, means every consumer of the model (and the gates that
 * decide whether such a leaf mounts at all) triggers the load; the by-id fetch
 * dedupes across callers and with `useFetchActiveTopicDetail`.
 */
export const useTopicModel = (): ModelAndProvider | undefined => {
  const topicId = useTopicId();

  const topicModel = useChatStore((s) =>
    topicId ? topicSelectors.getTopicModelById(topicId)(s) : undefined,
  );
  const isUnlistedTopic = useChatStore(
    (s) => !!topicId && !topicSelectors.getTopicById(topicId)(s),
  );
  const useFetchTopicDetail = useChatStore((s) => s.useFetchTopicDetail);
  useFetchTopicDetail(isUnlistedTopic ? topicId : undefined);

  return topicModel;
};

/**
 * The effective model/provider for ChatInput: the composer topic's pinned model
 * when one exists, otherwise the agent default.
 *
 * Use this everywhere a capability is gated on the model that will actually run
 * (vision/upload, tool use, builtin search, context window, …) so the controls
 * stay in sync with the topic model after a switch — not the stale agent
 * default. The Model control resolves display + switch routing
 * against the same topic model (see `useAgentModelSelection` composition there).
 */
export const useEffectiveModel = (agentId: string): ModelAndProvider => {
  const [agentModel, agentProvider] = useAgentStore((s) => [
    agentByIdSelectors.getAgentModelById(agentId)(s),
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
  ]);

  const topicModel = useTopicModel();

  return {
    model: topicModel?.model || agentModel,
    provider: topicModel?.model ? topicModel.provider : agentProvider,
  };
};

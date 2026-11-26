import { useCallback } from 'react';

import { useChatStore } from '@/store/chat';

import { useTopicModel } from '../../hooks/useEffectiveModel';
import { useTopicId } from '../../hooks/useTopicId';

interface ModelAndProvider {
  model: string;
  provider: string;
}

interface UseTopicModelSwitchOptions {
  canSelectModel: boolean;
  /**
   * Providers the agent default may use, when restricted (a live Agent Share).
   * A topic may still pin any model; one outside this list stays in that topic.
   */
  defaultProviders?: readonly string[];
  /** The agent-level selection (see `useAgentModelSelection`). */
  model: string;
  provider: string;
  selectModel: (params: ModelAndProvider) => Promise<unknown> | unknown;
  /**
   * `selectModel` would change the default of every Workspace member, so a
   * switch inside one topic must not carry over (see `useAgentModelSelection`).
   */
  selectsSharedDefault?: boolean;
}

/**
 * Topic-scoped model for the Model control: a topic pins its own model
 * (top-level `topics.model` column). Shows the pin of this composer's topic
 * (see `useTopicId`) when present, else the agent selection. Never the global
 * active topic: a page copilot beside a chat has `topicId: null` and must
 * neither show nor write the outer pin.
 *
 * A switch pins that topic and also becomes the caller's selection (via
 * `selectModel`, which honors workspace member overrides), so the next new
 * topic starts on the model the user last picked instead of reverting to the
 * old default. Other existing topics keep their own pins. The one exception is
 * a default the switch may not become: one other Workspace members share, or a
 * provider a live Agent Share rejects. Then the switch changes only that topic.
 */
export const useTopicModelSwitch = ({
  canSelectModel,
  defaultProviders,
  model: agentModel,
  provider: agentProvider,
  selectModel,
  selectsSharedDefault = false,
}: UseTopicModelSwitchOptions) => {
  const topicId = useTopicId();
  const topicModel = useTopicModel();
  const updateTopicModel = useChatStore((s) => s.updateTopicModel);
  const model = topicModel?.model ?? agentModel;
  const provider = topicModel?.model ? topicModel.provider : agentProvider;

  const switchModel = useCallback(
    async (params: ModelAndProvider) => {
      if (!canSelectModel) return;

      if (!topicId) {
        await selectModel(params);
        return;
      }

      const carriesOver =
        !selectsSharedDefault && (!defaultProviders || defaultProviders.includes(params.provider));
      // Start both writes together: the topic pin awaits a reasoning snapshot
      // and a server round trip, and a new topic opened in that window must
      // already read the new selection (both stores apply it optimistically).
      await Promise.all([
        updateTopicModel(topicId, params),
        carriesOver ? selectModel(params) : undefined,
      ]);
    },
    [
      canSelectModel,
      defaultProviders,
      selectModel,
      selectsSharedDefault,
      topicId,
      updateTopicModel,
    ],
  );

  return { model, provider, switchModel, topicId };
};

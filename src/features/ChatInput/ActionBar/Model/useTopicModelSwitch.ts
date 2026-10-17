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
  /** The agent-level selection (see `useAgentModelSelection`). */
  model: string;
  provider: string;
  selectModel: (params: ModelAndProvider) => Promise<unknown> | unknown;
}

/**
 * Topic-scoped model for the Model control: a topic pins its own model
 * (top-level `topics.model` column). Shows the pin of this composer's topic
 * (see `useTopicId`) when present, else the agent selection; a switch pins that
 * topic, otherwise updates the agent (via `selectModel`, which honors workspace
 * member overrides). Never the global active topic: a page copilot beside a
 * chat has `topicId: null` and must neither show nor write the outer pin.
 */
export const useTopicModelSwitch = ({
  canSelectModel,
  model: agentModel,
  provider: agentProvider,
  selectModel,
}: UseTopicModelSwitchOptions) => {
  const topicId = useTopicId();
  const topicModel = useTopicModel();
  const updateTopicModel = useChatStore((s) => s.updateTopicModel);
  const model = topicModel?.model ?? agentModel;
  const provider = topicModel?.model ? topicModel.provider : agentProvider;

  const switchModel = useCallback(
    async (params: ModelAndProvider) => {
      if (!canSelectModel) return;

      if (topicId) await updateTopicModel(topicId, params);
      else await selectModel(params);
    },
    [canSelectModel, selectModel, topicId, updateTopicModel],
  );

  return { model, provider, switchModel, topicId };
};

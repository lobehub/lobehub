import {
  applyTopicModelToHeterogeneousProvider,
  getHeteroSelectorCapability,
} from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useTopicId } from '../../hooks/useTopicId';

/**
 * The composer's heterogeneous provider with this topic's model, effort and speed pins
 * applied. Pins follow this composer's topic (see `useTopicId`), never the global active
 * topic; without a topic the agent's own config applies.
 */
export const useEffectiveHeteroProvider = () => {
  const agentId = useAgentId();
  const provider = useAgentStore(
    (s) => agentByIdSelectors.getAgencyConfigById(agentId)(s)?.heterogeneousProvider,
    isEqual,
  );
  const topicId = useTopicId();
  const topicPin = useChatStore(
    (s) => (topicId ? topicSelectors.getTopicHeteroPinById(topicId)(s) : undefined),
    isEqual,
  );
  const effectiveProvider = provider
    ? applyTopicModelToHeterogeneousProvider(provider, topicPin)
    : undefined;

  return { agentId, effectiveProvider, provider, topicId, topicPin };
};

/** The model this composer's next run uses, as the CLI names it (e.g. `opus`, `fable`). */
export const useSelectedHeteroModel = (): string | undefined => {
  const { effectiveProvider } = useEffectiveHeteroProvider();
  return getHeteroSelectorCapability(effectiveProvider?.type)?.model?.resolve(effectiveProvider);
};

import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import { useAgentId } from '../../hooks/useAgentId';
import { useEffectiveModel } from '../../hooks/useEffectiveModel';

/**
 * Whether the context-window ring can be computed: judged on the model this
 * composer actually runs (see `useEffectiveModel`), the same one
 * `useTokenBreakdown` counts against — not the agent default.
 */
export const useShowContextWindow = (): boolean => {
  const agentId = useAgentId();
  const { model, provider } = useEffectiveModel(agentId);

  return useAiInfraStore(aiModelSelectors.isModelHasContextWindowToken(model, provider));
};

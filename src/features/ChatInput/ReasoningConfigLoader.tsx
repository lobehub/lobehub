'use client';

import { memo } from 'react';

import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import { useAgentId } from './hooks/useAgentId';
import { useEffectiveModel } from './hooks/useEffectiveModel';

const Fetcher = memo<{ model: string; provider: string }>(({ model, provider }) => {
  const useFetchAiModelReasoningConfig = useAiInfraStore((s) => s.useFetchAiModelReasoningConfig);
  useFetchAiModelReasoningConfig(model, provider);

  return null;
});

Fetcher.displayName = 'ReasoningConfigFetcher';

/**
 * Headless loader that warms the user's model-instance reasoning config in the
 * aiInfra store for every chat surface. The send pipeline
 * (`resolveModelExtendParams`) reads that cache synchronously, and not every
 * surface mounts the Effort toolbar action (e.g. Home input, PageEditor
 * copilot), so the fetch cannot live only inside the action.
 */
const ReasoningConfigLoader = memo(() => {
  const agentId = useAgentId();
  const { model, provider } = useEffectiveModel(agentId);
  const hasReasoningParams = useAiInfraStore(
    aiModelSelectors.isModelHasReasoningExtendParams(model, provider),
  );

  if (!hasReasoningParams) return null;

  return <Fetcher model={model} provider={provider} />;
});

ReasoningConfigLoader.displayName = 'ReasoningConfigLoader';

export default ReasoningConfigLoader;

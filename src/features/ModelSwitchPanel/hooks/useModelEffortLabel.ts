import isEqual from 'fast-deep-equal';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveReasoningEffortValue } from '@/features/ChatInput/hooks/useReasoningEffortControl';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

/**
 * The reasoning effort a model would run at if picked now: the user's saved
 * per-model pick, else the card default. Returns `undefined` for
 * models without an effort param and while the saved value is still loading,
 * so a row never flashes the fallback before the real value arrives.
 *
 * Values come from the runtime-state response, which seeds every enabled
 * model's entry in one read. `ensureModelReasoningConfig` is only a fallback
 * for models the snapshot missed; it is a no-op once a key is cached
 * (including "nothing saved").
 */
export const useModelEffortLabel = (model: string, provider: string): string | undefined => {
  const { t } = useTranslation('chat');
  const effortSettings = useAiInfraStore(
    aiModelSelectors.modelReasoningEffortSettings(model, provider),
    isEqual,
  );
  const hasEffort = !!effortSettings;

  const ensureModelReasoningConfig = useAiInfraStore((s) => s.ensureModelReasoningConfig);
  useEffect(() => {
    if (hasEffort) void ensureModelReasoningConfig(model, provider);
  }, [hasEffort, ensureModelReasoningConfig, model, provider]);

  const loaded = useAiInfraStore(aiModelSelectors.isModelReasoningConfigLoaded(model, provider));
  const config = useAiInfraStore(aiModelSelectors.modelReasoningConfig(model, provider), isEqual);

  if (!hasEffort || !loaded) return undefined;

  const value = resolveReasoningEffortValue(effortSettings, config);

  return value ? t(`reasoningEffort.levels.${value}`) : undefined;
};

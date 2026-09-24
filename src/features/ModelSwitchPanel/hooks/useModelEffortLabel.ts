import isEqual from 'fast-deep-equal';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type EffortKey,
  resolveReasoningEffortValue,
} from '@/features/ChatInput/hooks/useReasoningEffortControl';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

/**
 * The reasoning effort a model would run at if picked now: the user's saved
 * per-model default, else the model's fallback level. Returns `undefined` for
 * models without an effort param and while the saved value is still loading,
 * so a row never flashes the fallback before the real value arrives.
 *
 * Rows warm the store through `ensureModelReasoningConfig`, which is a no-op
 * once a model's value is cached (including "nothing saved"), so reopening the
 * panel does not refetch; first-open requests land in one batched tRPC call.
 */
export const useModelEffortLabel = (model: string, provider: string): string | undefined => {
  const { t } = useTranslation('chat');
  const reasoningParams = useAiInfraStore(
    aiModelSelectors.modelReasoningExtendParams(model, provider),
    isEqual,
  );
  // modelReasoningExtendParams only returns reasoning-family params, so every
  // entry other than reasoningMode is an effort key
  const effortKey = reasoningParams.find((param) => param !== 'reasoningMode') as
    EffortKey | undefined;

  const ensureModelReasoningConfig = useAiInfraStore((s) => s.ensureModelReasoningConfig);
  useEffect(() => {
    if (effortKey) void ensureModelReasoningConfig(model, provider);
  }, [effortKey, ensureModelReasoningConfig, model, provider]);

  const loaded = useAiInfraStore(aiModelSelectors.isModelReasoningConfigLoaded(model, provider));
  const config = useAiInfraStore(aiModelSelectors.modelReasoningConfig(model, provider), isEqual);

  if (!effortKey || !loaded) return undefined;

  const value = resolveReasoningEffortValue(model, effortKey, config);

  return value ? t(`reasoningEffort.levels.${value}`) : undefined;
};

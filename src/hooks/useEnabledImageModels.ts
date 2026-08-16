import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { filterAicoManagedProviders } from '@/features/AicoBilling/isManagedRuntimeProvider';
import { isAicoManagedProviderMode } from '@/features/Conversation/Error/isAicoManagedProviderMode';
import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

/**
 * Enabled image models for the Image Create picker.
 * In Aico managed mode, only wallet-backed OpenRouter/`aico` providers are shown
 * (same product rule as chat — never BYOK Google/OpenAI keys).
 */
export const useEnabledImageModels = (): {
  isManagedStatusLoading: boolean;
  list: EnabledProviderWithModels[];
} => {
  const enabledImageModelList = useAiInfraStore(aiProviderSelectors.enabledImageModelList, isEqual);
  const { data: managedStatus, isLoading } = useClientDataSWR('aico-provider-status', () =>
    lambdaClient.aicoBilling.getManagedProviderStatus.query(),
  );

  const list = useMemo(() => {
    const raw = enabledImageModelList || [];
    // While status loads, expose an empty list so config init waits (avoids
    // locking onto Google defaults before we know Aico is managed-only).
    if (managedStatus === undefined && isLoading) return [];
    if (!isAicoManagedProviderMode(managedStatus?.managed)) return raw;
    return filterAicoManagedProviders(raw);
  }, [enabledImageModelList, isLoading, managedStatus]);

  return {
    isManagedStatusLoading: managedStatus === undefined && Boolean(isLoading),
    list,
  };
};

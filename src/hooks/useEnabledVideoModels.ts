import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { filterAicoManagedProviders } from '@/features/AicoBilling/isManagedRuntimeProvider';
import { isAicoManagedProviderMode } from '@/features/Conversation/Error/isAicoManagedProviderMode';
import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

/**
 * Enabled video models for the Video Create picker.
 * Aico managed mode: wallet-backed providers only (match chat / image).
 */
export const useEnabledVideoModels = (): {
  isManagedStatusLoading: boolean;
  list: EnabledProviderWithModels[];
} => {
  const enabledVideoModelList = useAiInfraStore(aiProviderSelectors.enabledVideoModelList, isEqual);
  const { data: managedStatus, isLoading } = useClientDataSWR('aico-provider-status', () =>
    lambdaClient.aicoBilling.getManagedProviderStatus.query(),
  );

  const list = useMemo(() => {
    const raw = enabledVideoModelList || [];
    if (managedStatus === undefined && isLoading) return [];
    if (!isAicoManagedProviderMode(managedStatus?.managed)) return raw;
    return filterAicoManagedProviders(raw);
  }, [enabledVideoModelList, isLoading, managedStatus]);

  return {
    isManagedStatusLoading: managedStatus === undefined && Boolean(isLoading),
    list,
  };
};

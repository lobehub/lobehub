import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import {
  filterAicoManagedProviders,
  isAicoManagedRuntimeProvider,
} from '@/features/AicoBilling/isManagedRuntimeProvider';
import { useAicoBillingStore } from '@/features/AicoBilling/store';
import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';
import { useAiInfraStore } from '@/store/aiInfra';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

/**
 * Enabled chat models for the model switcher.
 *
 * - In Aico managed mode: only `aico` / `openrouter` (wallet-backed keys).
 * - When the active billing source is an organization: also filter managed
 *   models by the member's team allow-list.
 */
export const useEnabledChatModels = (): EnabledProviderWithModels[] => {
  const enabledChatModelList = useAiInfraStore((s) => s.enabledChatModelList, isEqual);
  const billingContext = useAicoBillingStore((s) => s.context);

  const { data: managedStatus } = useClientDataSWR('aico-provider-status', () =>
    lambdaClient.aicoBilling.getManagedProviderStatus.query(),
  );
  // Fail-closed: hide BYOK providers until the API says unmanaged.
  const aicoManaged = managedStatus?.managed ?? true;

  const orgId =
    billingContext?.source === 'organization' ? billingContext.organizationId : undefined;

  const { data: allowed } = useClientDataSWR(orgId ? ['aico-my-allowed-models', orgId] : null, () =>
    lambdaClient.organization.getMyAllowedModels.query({ organizationId: orgId! }),
  );

  return useMemo(() => {
    const list = enabledChatModelList || [];
    const scoped = aicoManaged ? filterAicoManagedProviders(list) : list;

    if (!orgId) return scoped;
    // Fail closed while the allow-list loads: hide managed models until known.
    if (!allowed) {
      return scoped.filter((provider) => !isAicoManagedRuntimeProvider(provider.id));
    }

    const allowSet = new Set(allowed.modelIds);
    return scoped
      .map((provider) => {
        if (!isAicoManagedRuntimeProvider(provider.id)) return provider;
        const children = (provider.children || []).filter((model) => allowSet.has(model.id));
        return { ...provider, children };
      })
      .filter(
        (provider) =>
          !isAicoManagedRuntimeProvider(provider.id) || (provider.children?.length ?? 0) > 0,
      );
  }, [aicoManaged, allowed, enabledChatModelList, orgId]);
};

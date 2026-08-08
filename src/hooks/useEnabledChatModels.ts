import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';

import { useAicoBillingStore } from '@/features/AicoBilling/store';
import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';
import { useAiInfraStore } from '@/store/aiInfra';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

const isManagedProvider = (providerId: string) =>
  providerId === 'aico' || providerId === 'openrouter';

/**
 * Enabled chat models, filtered by org team grants when the active billing
 * source is an organization wallet.
 */
export const useEnabledChatModels = (): EnabledProviderWithModels[] => {
  const enabledChatModelList = useAiInfraStore((s) => s.enabledChatModelList, isEqual);
  const billingContext = useAicoBillingStore((s) => s.context);

  const orgId =
    billingContext?.source === 'organization' ? billingContext.organizationId : undefined;

  const { data: allowed } = useClientDataSWR(orgId ? ['aico-my-allowed-models', orgId] : null, () =>
    lambdaClient.organization.getMyAllowedModels.query({ organizationId: orgId! }),
  );

  return useMemo(() => {
    const list = enabledChatModelList || [];
    if (!orgId) return list;
    // Fail closed while the allow-list loads: hide managed models until known.
    if (!allowed) {
      return list.filter((provider) => !isManagedProvider(provider.id));
    }

    const allowSet = new Set(allowed.modelIds);
    return list
      .map((provider) => {
        if (!isManagedProvider(provider.id)) return provider;
        const children = (provider.children || []).filter((model) => allowSet.has(model.id));
        return { ...provider, children };
      })
      .filter(
        (provider) => !isManagedProvider(provider.id) || (provider.children?.length ?? 0) > 0,
      );
  }, [allowed, enabledChatModelList, orgId]);
};

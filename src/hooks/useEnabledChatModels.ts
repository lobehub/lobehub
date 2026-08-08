import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import isEqual from 'fast-deep-equal';
import { type AiModelForSelect, type AiProviderModelListItem } from 'model-bank';
import { useMemo } from 'react';

import {
  filterAicoManagedProviders,
  isAicoManagedRuntimeProvider,
} from '@/features/AicoBilling/isManagedRuntimeProvider';
import { useAicoBillingStore } from '@/features/AicoBilling/store';
import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';
import { aiModelService } from '@/services/aiModel';
import { useAiInfraStore } from '@/store/aiInfra';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

const catalogModelToSelect = (model: AiProviderModelListItem): AiModelForSelect => ({
  abilities: (model.abilities || {}) as AiModelForSelect['abilities'],
  contextWindowTokens: model.contextWindowTokens,
  description: model.description,
  displayName: model.displayName,
  family: model.family,
  generation: model.generation,
  id: model.id,
  knowledgeCutoff: model.knowledgeCutoff,
  parameters: model.parameters,
  pricing: model.pricing,
  releasedAt: model.releasedAt,
});

/**
 * Enabled chat models for the model switcher.
 *
 * - Personal wallet: user's enabled managed models (preferences).
 * - Org wallet: team allow-list only — built from the managed catalog,
 *   ignoring personal enable toggles.
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

  const { data: catalog } = useClientDataSWR(
    orgId ? ['aico-managed-model-catalog', orgId] : null,
    () => aiModelService.getAiProviderModelList(DEFAULT_PROVIDER),
  );

  return useMemo(() => {
    const list = enabledChatModelList || [];
    const scoped = aicoManaged ? filterAicoManagedProviders(list) : list;

    if (!orgId) return scoped;

    // Fail closed while allow-list or catalog loads: hide managed models until known.
    if (!allowed || !catalog) {
      return scoped.filter((provider) => !isAicoManagedRuntimeProvider(provider.id));
    }

    const allowSet = new Set(allowed.modelIds);
    const children = catalog
      .filter((model) => (model.type || 'chat') === 'chat' && allowSet.has(model.id))
      .map(catalogModelToSelect);

    if (children.length === 0) {
      return scoped.filter((provider) => !isAicoManagedRuntimeProvider(provider.id));
    }

    const managedFromPersonal = scoped.find((provider) =>
      isAicoManagedRuntimeProvider(provider.id),
    );

    const orgProvider: EnabledProviderWithModels = {
      children,
      id: managedFromPersonal?.id ?? DEFAULT_PROVIDER,
      name: managedFromPersonal?.name ?? 'OpenRouter',
      source: managedFromPersonal?.source ?? 'builtin',
    };

    const byok = aicoManaged
      ? []
      : scoped.filter((provider) => !isAicoManagedRuntimeProvider(provider.id));

    return [orgProvider, ...byok];
  }, [aicoManaged, allowed, catalog, enabledChatModelList, orgId]);
};

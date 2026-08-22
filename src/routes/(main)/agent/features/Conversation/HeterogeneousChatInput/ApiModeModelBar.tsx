'use client';

import type { HeterogeneousApiConfig } from '@lobechat/types';
import { memo, useMemo } from 'react';

import { useProviderBindingCompatibleProviders } from '@/features/HeterogeneousAgent/hooks/useProviderBinding';
import ModelSelect from '@/features/ModelSelect';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

interface ApiModeModelBarProps {
  agentId: string;
}

const ApiModeModelBar = memo<ApiModeModelBarProps>(({ agentId }) => {
  const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  const updateAgentConfigById = useAgentStore((state) => state.updateAgentConfigById);
  const heterogeneousProvider = agencyConfig?.heterogeneousProvider;
  const { providers } = useProviderBindingCompatibleProviders(heterogeneousProvider?.type);
  const providerIds = useMemo(() => providers.map(({ id }) => id), [providers]);

  if (
    !heterogeneousProvider ||
    heterogeneousProvider.authMode !== 'api' ||
    providerIds.length === 0
  )
    return null;

  const persist = async (apiConfig: HeterogeneousApiConfig) => {
    await updateAgentConfigById(agentId, {
      agencyConfig: {
        ...agencyConfig,
        heterogeneousProvider: { ...heterogeneousProvider, apiConfig },
      },
    });
  };

  return (
    <ModelSelect
      initialWidth
      popupWidth={360}
      providerIds={providerIds}
      size="small"
      variant="borderless"
      value={
        heterogeneousProvider.apiConfig
          ? {
              model: heterogeneousProvider.apiConfig.model,
              provider: heterogeneousProvider.apiConfig.providerId,
            }
          : undefined
      }
      onChange={({ model, provider }) => {
        const smallFastModel =
          heterogeneousProvider.apiConfig?.providerId === provider
            ? heterogeneousProvider.apiConfig.smallFastModel
            : undefined;
        void persist({ model, providerId: provider, smallFastModel });
      }}
    />
  );
});

ApiModeModelBar.displayName = 'ApiModeModelBar';

export default ApiModeModelBar;

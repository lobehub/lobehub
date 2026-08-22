'use client';

import type { HeterogeneousApiConfig } from '@lobechat/types';
import { Select } from '@lobehub/ui/base-ui';
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
  const serverDefaultAgentType =
    heterogeneousProvider?.type === 'claude-code' || heterogeneousProvider?.type === 'codex'
      ? heterogeneousProvider.type
      : undefined;
  const serverDefaultSelected = heterogeneousProvider?.apiConfig?.source === 'server-default';
  const useFetchServerDefaultCapability = useAgentStore(
    (state) => state.useFetchServerDefaultHeterogeneousCapability,
  );
  const serverCapability = useFetchServerDefaultCapability(
    serverDefaultSelected && !!serverDefaultAgentType,
  );
  const serverDefaultModels =
    serverCapability.data?.enabled === true && serverDefaultAgentType
      ? serverCapability.data.models[serverDefaultAgentType]
      : [];

  if (
    !heterogeneousProvider ||
    heterogeneousProvider.authMode !== 'api' ||
    (!serverDefaultSelected && providerIds.length === 0)
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

  if (serverDefaultSelected) {
    return (
      <Select
        loading={serverCapability.isLoading}
        options={serverDefaultModels.map(({ model }) => ({ label: model, value: model }))}
        size="small"
        value={heterogeneousProvider.apiConfig.model}
        variant="borderless"
        onChange={(model) => {
          if (typeof model === 'string') void persist({ model, source: 'server-default' });
        }}
      />
    );
  }

  const providerApiConfig = heterogeneousProvider.apiConfig;

  return (
    <ModelSelect
      initialWidth
      popupWidth={360}
      providerIds={providerIds}
      size="small"
      variant="borderless"
      value={
        providerApiConfig
          ? {
              model: providerApiConfig.model,
              provider: providerApiConfig.providerId,
            }
          : undefined
      }
      onChange={({ model, provider }) => {
        const smallFastModel =
          providerApiConfig?.providerId === provider ? providerApiConfig.smallFastModel : undefined;
        void persist({ model, providerId: provider, smallFastModel });
      }}
    />
  );
});

ApiModeModelBar.displayName = 'ApiModeModelBar';

export default ApiModeModelBar;

'use client';

import type { HeterogeneousApiConfig } from '@lobechat/types';
import { applyHeteroSelection, getHeteroSelectorCapability } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import HeteroModel from '@/features/ChatInput/ControlBar/HeteroModel';
import { resolveModelDependentSelection } from '@/features/ChatInput/ControlBar/HeteroModel/selectorView';
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
    const capability = getHeteroSelectorCapability(heterogeneousProvider.type);
    const dependentSelection = capability
      ? resolveModelDependentSelection({
          capability,
          effort: capability.effort?.resolve(heterogeneousProvider),
          isFastSpeed: false,
          value: apiConfig.model,
        })
      : {};

    await updateAgentConfigById(agentId, {
      agencyConfig: {
        ...agencyConfig,
        heterogeneousProvider: {
          ...heterogeneousProvider,
          ...applyHeteroSelection(heterogeneousProvider, dependentSelection),
          apiConfig,
        },
      },
    });
  };

  return (
    <Flexbox horizontal align="center" flex="none" gap={4} width="fit-content">
      <Flexbox flex="none" width={140}>
        <ModelSelect
          popupWidth={240}
          providerIds={providerIds}
          size="small"
          style={{ minWidth: 0 }}
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
      </Flexbox>
      <HeteroModel
        effortOnly
        agentId={agentId}
        selectedModel={heterogeneousProvider.apiConfig?.model}
      />
    </Flexbox>
  );
});

ApiModeModelBar.displayName = 'ApiModeModelBar';

export default ApiModeModelBar;

'use client';

import type { HeterogeneousApiConfig } from '@lobechat/types';
import { TooltipGroup } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { memo, useMemo } from 'react';

import { useProviderBindingCompatibleProviders } from '@/features/HeterogeneousAgent/hooks/useProviderBinding';
import {
  buildServerDefaultModelOptions,
  MODEL_PICKER_STYLE,
  modelPickerStyles,
} from '@/features/HeterogeneousAgent/modelPicker';
import ModelSelect from '@/features/ModelSelect';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useAiInfraStore } from '@/store/aiInfra';

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
  const apiConfig = heterogeneousProvider?.apiConfig;
  const serverDefaultApiConfig = apiConfig?.source === 'server-default' ? apiConfig : undefined;
  const providerApiConfig =
    apiConfig && apiConfig.source !== 'server-default' ? apiConfig : undefined;
  const useFetchServerDefaultCapability = useAgentStore(
    (state) => state.useFetchServerDefaultHeterogeneousCapability,
  );
  const serverCapability = useFetchServerDefaultCapability(
    !!serverDefaultApiConfig && !!serverDefaultAgentType,
  );
  const builtinAiModelList = useAiInfraStore((state) => state.builtinAiModelList);
  const serverDefaultModelOptions = useMemo(() => {
    const models =
      serverCapability.data?.enabled === true && serverDefaultAgentType
        ? serverCapability.data.models[serverDefaultAgentType]
        : [];
    return buildServerDefaultModelOptions(models, builtinAiModelList);
  }, [builtinAiModelList, serverCapability.data, serverDefaultAgentType]);

  if (
    !heterogeneousProvider ||
    heterogeneousProvider.authMode !== 'api' ||
    (!serverDefaultApiConfig && providerIds.length === 0)
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

  if (serverDefaultApiConfig) {
    return (
      <TooltipGroup>
        <Select
          popupMatchSelectWidth
          className={modelPickerStyles.picker}
          loading={serverCapability.isLoading}
          options={serverDefaultModelOptions}
          size="small"
          style={MODEL_PICKER_STYLE}
          value={serverDefaultApiConfig.model}
          variant="borderless"
          onChange={(model) => {
            if (typeof model === 'string') void persist({ model, source: 'server-default' });
          }}
        />
      </TooltipGroup>
    );
  }

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

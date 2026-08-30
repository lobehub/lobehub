'use client';

import { isServerDefaultHeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import type { HeterogeneousApiConfig } from '@lobechat/types';
import { applyTopicModelToHeterogeneousProvider } from '@lobechat/types';
import { TooltipGroup } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { memo, useMemo } from 'react';

import { useProviderBindingCompatibleProviders } from '@/features/HeterogeneousAgent/hooks/useProviderBinding';
import {
  buildServerDefaultModelOptions,
  COMPACT_MODEL_PICKER_STYLE,
  compactModelTriggerText,
  modelPickerStyles,
  resolveServerDefaultAgentModels,
} from '@/features/HeterogeneousAgent/modelPicker';
import ModelSelect from '@/features/ModelSelect';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useAiInfraStore } from '@/store/aiInfra';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';

interface ApiModeModelBarProps {
  agentId: string;
}

const compactTriggerLabel = (option: { title?: string; value?: unknown }) => (
  <span className={modelPickerStyles.compactLabel}>{compactModelTriggerText(option)}</span>
);

const ApiModeModelBar = memo<ApiModeModelBarProps>(({ agentId }) => {
  const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  const updateAgentConfigById = useAgentStore((state) => state.updateAgentConfigById);
  const heterogeneousProvider = agencyConfig?.heterogeneousProvider;
  const activeTopicId = useChatStore((state) => state.activeTopicId);
  const topicModel = useChatStore(topicSelectors.activeTopicModel);
  const updateTopicModel = useChatStore((state) => state.updateTopicModel);
  const { providers } = useProviderBindingCompatibleProviders(heterogeneousProvider?.type);
  const providerIds = useMemo(() => providers.map(({ id }) => id), [providers]);
  const serverDefaultAgentType =
    heterogeneousProvider && isServerDefaultHeterogeneousAgentType(heterogeneousProvider.type)
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
        ? resolveServerDefaultAgentModels(serverCapability.data.models, serverDefaultAgentType)
        : [];
    return buildServerDefaultModelOptions(models, builtinAiModelList);
  }, [builtinAiModelList, serverCapability.data, serverDefaultAgentType]);

  if (
    !heterogeneousProvider ||
    heterogeneousProvider.authMode !== 'api' ||
    (!serverDefaultApiConfig && providerIds.length === 0)
  )
    return null;

  const effectiveProvider = applyTopicModelToHeterogeneousProvider(
    heterogeneousProvider,
    topicModel,
  );
  const effectiveApiConfig = effectiveProvider.apiConfig;
  const effectiveProviderApiConfig =
    effectiveApiConfig?.source !== 'server-default' ? effectiveApiConfig : undefined;

  const persist = async (apiConfig: HeterogeneousApiConfig) => {
    if (activeTopicId && apiConfig.source !== 'server-default' && apiConfig.providerId) {
      await updateTopicModel(activeTopicId, {
        model: apiConfig.model,
        provider: apiConfig.providerId,
      });
      return;
    }

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
          className={modelPickerStyles.picker}
          labelRender={compactTriggerLabel}
          loading={serverCapability.isLoading}
          options={serverDefaultModelOptions}
          popupMatchSelectWidth={false}
          size="small"
          style={COMPACT_MODEL_PICKER_STYLE}
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
      labelRender={compactTriggerLabel}
      popupWidth={360}
      providerIds={providerIds}
      size="small"
      style={COMPACT_MODEL_PICKER_STYLE}
      variant="borderless"
      value={
        effectiveProviderApiConfig
          ? {
              model: effectiveProviderApiConfig.model,
              provider: effectiveProviderApiConfig.providerId,
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

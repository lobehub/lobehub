'use client';

import type { HeterogeneousApiConfig } from '@lobechat/types';
import { memo, useMemo } from 'react';

import { useClaudeCodeCompatibleProviders } from '@/features/Electron/HeterogeneousAgent/hooks/useClaudeCodeCompatibleProviders';
import ModelSelect from '@/features/ModelSelect';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

interface ApiModeModelBarProps {
  agentId: string;
}

const ApiModeModelBar = memo<ApiModeModelBarProps>(({ agentId }) => {
  const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);

  const { providers } = useClaudeCodeCompatibleProviders();
  const providerIds = useMemo(() => providers.map((p) => p.id), [providers]);

  const heterogeneousProvider = agencyConfig?.heterogeneousProvider;
  const authMode = heterogeneousProvider?.authMode ?? 'subscription';
  const apiConfig = heterogeneousProvider?.apiConfig;

  // Only render in API mode. Returning null (instead of a placeholder) keeps
  // the subscription path visually unchanged.
  if (authMode !== 'api' || !heterogeneousProvider) return null;
  if (providerIds.length === 0) return null;

  const persist = async (next: HeterogeneousApiConfig) => {
    await updateAgentConfigById(agentId, {
      agencyConfig: {
        ...agencyConfig,
        heterogeneousProvider: {
          ...heterogeneousProvider,
          apiConfig: next,
        },
      },
    });
  };

  const handleChange = async ({ model, provider }: { model: string; provider: string }) => {
    // Switching provider drops the previous fast model (different API key). Use ''
    // not undefined so config persistence (deep-merge, skips undefined) overwrites it.
    const smallFastModel = apiConfig?.providerId === provider ? apiConfig.smallFastModel : '';
    await persist({ model, providerId: provider, smallFastModel });
  };

  return (
    <ModelSelect
      initialWidth
      popupWidth={360}
      providerIds={providerIds}
      size="small"
      value={apiConfig ? { model: apiConfig.model, provider: apiConfig.providerId } : undefined}
      variant="borderless"
      onChange={(next) => {
        void handleChange(next);
      }}
    />
  );
});

ApiModeModelBar.displayName = 'HeterogeneousApiModeModelBar';

export default ApiModeModelBar;

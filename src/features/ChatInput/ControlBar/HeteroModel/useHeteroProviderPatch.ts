import type { HeterogeneousProviderConfig, HeteroSelection } from '@lobechat/types';
import { applyHeteroSelection } from '@lobechat/types';
import { useCallback } from 'react';

import { useAgentStore } from '@/store/agent';

export const useHeteroProviderPatch = ({
  agentId,
  enabled,
  provider,
}: {
  agentId?: string;
  enabled: boolean;
  provider: HeterogeneousProviderConfig | undefined;
}) => {
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);

  return useCallback(
    async (selection: HeteroSelection) => {
      if (!enabled || !agentId) return;

      await updateAgentConfigById(agentId, {
        agencyConfig: { heterogeneousProvider: applyHeteroSelection(provider, selection) },
      });
    },
    [agentId, enabled, provider, updateAgentConfigById],
  );
};

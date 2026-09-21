import type { HeterogeneousProviderConfig, HeteroSelection } from '@lobechat/types';
import { applyHeteroSelection } from '@lobechat/types';
import { useCallback } from 'react';

import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

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
  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const updateTopicHeteroPin = useChatStore((s) => s.updateTopicHeteroPin);

  return useCallback(
    async (selection: HeteroSelection) => {
      if (!enabled || !agentId || !provider) return;

      // Model and effort are topic-scoped once a topic exists (the topic keeps
      // its own pins, see `ChatTopic.model` / `ChatTopicMetadata.heteroEffort`);
      // the remaining dimensions (mode, speed) still write the shared agent config.
      const { effort, model, ...agentSelection } = selection;
      if (activeTopicId) {
        if (model !== undefined || effort !== undefined) {
          await updateTopicHeteroPin(activeTopicId, { effort, model, provider: provider.type });
        }
        if (Object.keys(agentSelection).length === 0) return;
      }
      await updateAgentConfigById(agentId, {
        agencyConfig: {
          heterogeneousProvider: applyHeteroSelection(
            provider,
            activeTopicId ? agentSelection : selection,
          ),
        },
      });
    },
    [activeTopicId, agentId, enabled, provider, updateAgentConfigById, updateTopicHeteroPin],
  );
};

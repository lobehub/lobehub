import type { HeterogeneousProviderConfig, HeteroSelection } from '@lobechat/types';
import { applyHeteroSelection } from '@lobechat/types';
import { useCallback } from 'react';

import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

import { useTopicId } from '../../hooks/useTopicId';

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
  // This composer's conversation (see `useTopicId`), never the global active topic.
  const topicId = useTopicId();
  const updateTopicHeteroPin = useChatStore((s) => s.updateTopicHeteroPin);

  return useCallback(
    async (selection: HeteroSelection) => {
      if (!enabled || !agentId || !provider) return;

      // Model, effort and speed are topic-scoped once a topic exists (the topic
      // keeps its own pins, see `ChatTopic.model` / `ChatTopicMetadata.heteroEffort`
      // / `heteroSpeed`); mode still writes the shared agent config.
      const { effort, model, speed, ...agentSelection } = selection;
      if (topicId) {
        if (model !== undefined || effort !== undefined || speed !== undefined) {
          await updateTopicHeteroPin(topicId, {
            effort,
            model,
            provider: provider.type,
            ...(speed === undefined ? {} : { speed }),
          });
        }
        if (Object.keys(agentSelection).length === 0) return;
      }
      await updateAgentConfigById(agentId, {
        agencyConfig: {
          heterogeneousProvider: applyHeteroSelection(
            provider,
            topicId ? agentSelection : selection,
          ),
        },
      });
    },
    [agentId, enabled, provider, topicId, updateAgentConfigById, updateTopicHeteroPin],
  );
};

import { useCallback, useMemo } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';
import type { TopicGroupMode } from '@/types/topic';

import { resolveAgentTopicGroupMode } from '../utils/topicGroupMode';

export const useAgentTopicGroupMode = () => {
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const agentType = useAgentStore(agentSelectors.currentAgentHeterogeneousProviderType);
  const [agentTopicGroupModes, globalMode, updatePreference] = useUserStore((s) => [
    preferenceSelectors.topicGroupModeByAgentId(s),
    preferenceSelectors.topicGroupMode(s),
    s.updatePreference,
  ]);

  const agentSpecificMode = activeAgentId ? agentTopicGroupModes[activeAgentId] : undefined;
  const topicGroupMode = resolveAgentTopicGroupMode({
    agentSpecificMode,
    agentType,
    globalMode,
  });

  const updateTopicGroupMode = useCallback(
    async (mode: TopicGroupMode) => {
      if (!activeAgentId) {
        await updatePreference({ topicGroupMode: mode });
        return;
      }

      await updatePreference({
        topicGroupModeByAgentId: {
          ...agentTopicGroupModes,
          [activeAgentId]: mode,
        },
      });
    },
    [activeAgentId, agentTopicGroupModes, updatePreference],
  );

  return useMemo(
    () => ({
      topicGroupMode,
      updateTopicGroupMode,
    }),
    [topicGroupMode, updateTopicGroupMode],
  );
};

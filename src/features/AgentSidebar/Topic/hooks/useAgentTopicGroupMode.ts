import { useCallback, useMemo } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';
import type { TopicGroupMode } from '@/types/topic';

import { useTopicListScope } from '../TopicListScope';
import { resolveAgentTopicGroupMode } from '../utils/topicGroupMode';

export const useAgentTopicGroupMode = () => {
  const scope = useTopicListScope();
  const updatePreference = useUserStore((s) => s.updatePreference);
  const agentType = useAgentStore(agentSelectors.currentAgentHeterogeneousProviderType);
  const agentTopicGroupMode = useAgentStore(
    (s) => agentSelectors.currentAgentConfig(s)?.chatConfig?.topicGroupMode,
  );
  const updateAgentChatConfig = useAgentStore((s) => s.updateAgentChatConfig);
  const globalMode = useUserStore(preferenceSelectors.topicGroupMode);

  const topicGroupMode = scope
    ? globalMode
    : resolveAgentTopicGroupMode({
        agentTopicGroupMode,
        agentType,
        globalMode,
      });

  const updateTopicGroupMode = useCallback(
    async (mode: TopicGroupMode) => {
      if (scope) await updatePreference({ topicGroupMode: mode });
      else await updateAgentChatConfig({ topicGroupMode: mode });
    },
    [scope, updateAgentChatConfig, updatePreference],
  );

  return useMemo(
    () => ({
      topicGroupMode,
      updateTopicGroupMode,
    }),
    [topicGroupMode, updateTopicGroupMode],
  );
};

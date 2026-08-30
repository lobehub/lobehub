import { useCallback, useMemo } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentProjectionSelectors, useCurrentAgentValue } from '@/store/agent/projection';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';
import type { TopicGroupMode } from '@/types/topic';

import { resolveAgentTopicGroupMode } from '../utils/topicGroupMode';

export const useAgentTopicGroupMode = () => {
  const agentType = useCurrentAgentValue(agentProjectionSelectors.heterogeneousProviderType);
  const agentTopicGroupMode = useCurrentAgentValue((agent) => agent?.chatConfig?.topicGroupMode);
  const updateAgentChatConfig = useAgentStore((s) => s.updateAgentChatConfig);
  const globalMode = useUserStore(preferenceSelectors.topicGroupMode);

  const topicGroupMode = resolveAgentTopicGroupMode({
    agentTopicGroupMode,
    agentType,
    globalMode,
  });

  const updateTopicGroupMode = useCallback(
    async (mode: TopicGroupMode) => {
      await updateAgentChatConfig({ topicGroupMode: mode });
    },
    [updateAgentChatConfig],
  );

  return useMemo(
    () => ({
      topicGroupMode,
      updateTopicGroupMode,
    }),
    [topicGroupMode, updateTopicGroupMode],
  );
};

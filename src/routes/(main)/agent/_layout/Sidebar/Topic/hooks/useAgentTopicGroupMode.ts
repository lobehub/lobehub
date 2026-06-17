import { useCallback, useMemo } from 'react';

import { useRouteAgentId } from '@/hooks/useRouteAgentId';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';
import type { TopicGroupMode } from '@/types/topic';

import { resolveAgentTopicGroupMode } from '../utils/topicGroupMode';

export const useAgentTopicGroupMode = () => {
  const agentId = useRouteAgentId();
  const agentType = useAgentStore(
    (s) => agentByIdSelectors.getAgencyConfigById(agentId)(s)?.heterogeneousProvider?.type,
  );
  const agentTopicGroupMode = useAgentStore(
    (s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s)?.topicGroupMode,
  );
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

import type { HeterogeneousProviderConfig } from '@lobechat/types';
import { HETEROGENEOUS_AGENT_CONFIGS } from '@lobechat/types';

import type { TopicGroupMode } from '@/types/topic';

type HeterogeneousAgentType = HeterogeneousProviderConfig['type'];

/**
 * Topic-grouping default declared per CLI agent in the shared descriptor
 * catalog (`defaultTopicGroupMode`). Derived from the catalog so agents added
 * later inherit the behavior automatically.
 */
const DEFAULT_TOPIC_GROUP_MODE_BY_AGENT_TYPE = new Map<HeterogeneousAgentType, TopicGroupMode>(
  HETEROGENEOUS_AGENT_CONFIGS.flatMap(({ defaultTopicGroupMode, type }) =>
    defaultTopicGroupMode ? [[type, defaultTopicGroupMode]] : [],
  ),
);

export const getDefaultTopicGroupModeByAgentType = (
  fallbackMode: TopicGroupMode,
  agentType?: HeterogeneousAgentType,
): TopicGroupMode =>
  agentType
    ? (DEFAULT_TOPIC_GROUP_MODE_BY_AGENT_TYPE.get(agentType) ?? fallbackMode)
    : fallbackMode;

export const resolveAgentTopicGroupMode = ({
  agentTopicGroupMode,
  agentType,
  globalMode,
}: {
  agentTopicGroupMode?: TopicGroupMode;
  agentType?: HeterogeneousAgentType;
  globalMode: TopicGroupMode;
}): TopicGroupMode => {
  if (agentTopicGroupMode) return agentTopicGroupMode;

  return getDefaultTopicGroupModeByAgentType(globalMode, agentType);
};

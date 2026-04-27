import type { HeterogeneousProviderConfig } from '@lobechat/types';

import type { TopicGroupMode } from '@/types/topic';

type HeterogeneousAgentType = HeterogeneousProviderConfig['type'];

const PROJECT_DEFAULT_HETEROGENEOUS_AGENT_TYPES = new Set<HeterogeneousAgentType>([
  'claude-code',
  'codex',
]);

export const getDefaultTopicGroupModeByAgentType = (
  fallbackMode: TopicGroupMode,
  agentType?: HeterogeneousAgentType,
): TopicGroupMode =>
  agentType && PROJECT_DEFAULT_HETEROGENEOUS_AGENT_TYPES.has(agentType)
    ? 'byProject'
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

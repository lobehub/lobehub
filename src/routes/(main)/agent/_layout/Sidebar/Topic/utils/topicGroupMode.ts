import { DEFAULT_PREFERENCE } from '@lobechat/const';
import type { HeterogeneousProviderConfig } from '@lobechat/types';

import type { TopicGroupMode } from '@/types/topic';

type HeterogeneousAgentType = HeterogeneousProviderConfig['type'];

const DEFAULT_TOPIC_GROUP_MODE = DEFAULT_PREFERENCE.topicGroupMode ?? 'byTime';

const PROJECT_DEFAULT_HETEROGENEOUS_AGENT_TYPES = new Set<HeterogeneousAgentType>([
  'claude-code',
  'codex',
]);

export const getDefaultTopicGroupModeByAgentType = (
  agentType?: HeterogeneousAgentType,
): TopicGroupMode =>
  agentType && PROJECT_DEFAULT_HETEROGENEOUS_AGENT_TYPES.has(agentType)
    ? 'byProject'
    : DEFAULT_TOPIC_GROUP_MODE;

export const resolveAgentTopicGroupMode = ({
  agentSpecificMode,
  agentType,
  globalMode,
}: {
  agentSpecificMode?: TopicGroupMode;
  agentType?: HeterogeneousAgentType;
  globalMode: TopicGroupMode;
}): TopicGroupMode => {
  if (agentSpecificMode) return agentSpecificMode;

  return globalMode === DEFAULT_TOPIC_GROUP_MODE
    ? getDefaultTopicGroupModeByAgentType(agentType)
    : globalMode;
};

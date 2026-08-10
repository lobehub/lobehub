import type { HeterogeneousProviderConfig } from '@lobechat/types';
import { HETEROGENEOUS_AGENT_CONFIGS } from '@lobechat/types';

import type { TopicGroupMode } from '@/types/topic';

type HeterogeneousAgentType = HeterogeneousProviderConfig['type'];

/**
 * CLI agents declared to default to folder/project grouping in the shared
 * descriptor catalog (`defaultTopicGroupMode: 'byProject'`). Derived from the
 * catalog so agents added later inherit the behavior automatically.
 */
const PROJECT_DEFAULT_HETEROGENEOUS_AGENT_TYPES = new Set<HeterogeneousAgentType>(
  HETEROGENEOUS_AGENT_CONFIGS.filter(
    ({ defaultTopicGroupMode }) => defaultTopicGroupMode === 'byProject',
  ).map(({ type }) => type),
);

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

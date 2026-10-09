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
  const resolved = agentTopicGroupMode
    ? agentTopicGroupMode
    : getDefaultTopicGroupModeByAgentType(globalMode, agentType);

  // "by agent" is only offered in project-scoped lists. When it leaks into
  // the global preference (set from a project sidebar), a single agent's own
  // topics would render as one pointless self-named bucket — keep the
  // previous default grouping. Project-scoped lists read the global mode
  // directly and are unaffected by this fallback.
  return resolved === 'byAgent' ? 'byTime' : resolved;
};

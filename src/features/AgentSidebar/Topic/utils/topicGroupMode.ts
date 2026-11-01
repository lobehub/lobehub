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

  // "by agent" and "by device" are only offered in project-scoped lists. When
  // they sit in the global preference (set from a project sidebar before
  // projects kept their own), a single
  // agent's own topics would render as one pointless self-named bucket — keep
  // the previous default grouping. Project-scoped lists resolve through
  // `resolveProjectTopicGroupMode` instead.
  return resolved === 'byAgent' || resolved === 'byDevice' ? 'byTime' : resolved;
};

/**
 * Project-scoped lists read their own preference (default: by agent). They
 * already belong to one project, so "by project" is not offered there; a stale
 * value falls back to grouping by agent instead of one project-wide bucket.
 */
export const resolveProjectTopicGroupMode = (projectMode: TopicGroupMode): TopicGroupMode =>
  projectMode === 'byProject' ? 'byAgent' : projectMode;

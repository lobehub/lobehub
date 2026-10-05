import type { TopicQuerySortBy } from '@lobechat/types';

import { MAIN_SIDEBAR_EXCLUDE_TRIGGERS } from '@/const/topic';
import { resolveAgentTopicGroupMode } from '@/features/AgentSidebar/Topic/utils/topicGroupMode';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import {
  normalizeTopicListParams,
  type TopicListParams,
} from '@/store/chat/slices/topic/projection';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';
import type { TopicGroupMode } from '@/types/topic';

const EXCLUDE_STATUSES_COMPLETED = ['completed'];

/**
 * Filter / sort identity of a sidebar list request — the local-first resource's
 * `query`, which decides which persisted row may hydrate the bucket.
 */
export interface SidebarTopicListQuery {
  excludeStatuses?: string[];
  excludeTriggers?: string[];
  sortBy?: TopicQuerySortBy;
}

/**
 * Pure derivation of that identity from its inputs.
 *
 * Both readers below feed it — the reactive hook that renders the sidebar and
 * the imperative one the route loader uses before the first paint — so the two
 * paths can never ask for different rows.
 *
 * "Group by status" ordering is resolved server-side so the highest-priority
 * topics stay on the first page even when the list is paginated; only the agent
 * sidebar supports it, group sessions keep the default updatedAt ordering.
 */
export const deriveSidebarTopicListQuery = ({
  includeCompleted,
  isGroupSession,
  topicGroupMode,
}: {
  includeCompleted: boolean;
  isGroupSession: boolean;
  topicGroupMode: TopicGroupMode;
}): SidebarTopicListQuery => ({
  excludeStatuses: includeCompleted ? undefined : EXCLUDE_STATUSES_COMPLETED,
  excludeTriggers: MAIN_SIDEBAR_EXCLUDE_TRIGGERS,
  sortBy: !isGroupSession && topicGroupMode === 'byStatus' ? 'status' : undefined,
});

/**
 * Topic-group mode of one agent, resolved the same way the sidebar resolves it
 * for the active agent (agent config → CLI-agent default → user preference).
 */
export const getTopicGroupModeForAgent = (agentId?: string): TopicGroupMode => {
  const agentState = useAgentStore.getState();
  const config = agentId
    ? agentSelectors.getAgentConfigById(agentId)(agentState)
    : agentSelectors.currentAgentConfig(agentState);

  return resolveAgentTopicGroupMode({
    agentTopicGroupMode: config?.chatConfig?.topicGroupMode,
    agentType: config?.agencyConfig?.heterogeneousProvider?.type,
    globalMode: preferenceSelectors.topicGroupMode(useUserStore.getState()),
  });
};

/**
 * The exact params the agent sidebar will ask for, computed without React so a
 * route loader can hydrate the persisted page before the first paint.
 *
 * `session.agentId` names the *route's* agent: until the agent layout commits,
 * the stores still hold the previously active agent.
 */
export const getSidebarTopicListParams = (session: {
  agentId?: string;
  groupId?: string;
}): TopicListParams | null => {
  const { agentId, groupId } = session;
  if (!agentId && !groupId) return null;

  const agentState = useAgentStore.getState();
  const inboxAgentId = builtinAgentSelectors.inboxAgentId(agentState);

  return normalizeTopicListParams({
    ...deriveSidebarTopicListQuery({
      includeCompleted: preferenceSelectors.topicIncludeCompleted(useUserStore.getState()),
      isGroupSession: !!groupId,
      topicGroupMode: getTopicGroupModeForAgent(agentId),
    }),
    agentId,
    groupId,
    isInbox: !groupId && !!inboxAgentId && inboxAgentId === agentId,
    pageSize: systemStatusSelectors.topicPageSize(useGlobalStore.getState()),
  });
};

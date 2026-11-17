import type { TopicQuerySortBy } from '@lobechat/types';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import {
  MAIN_SIDEBAR_EXCLUDE_TRIGGERS,
  MAIN_SIDEBAR_EXCLUDE_TRIGGERS_WITH_OPENED_FOR_ME,
} from '@/const/topic';
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
import { labPreferSelectors, preferenceSelectors } from '@/store/user/selectors';
import type { TopicGroupMode } from '@/types/topic';

const EXCLUDE_STATUSES_COMPLETED = ['completed'];

/**
 * Filter / sort identity of a sidebar list request — the local-first resource's
 * `query`, which decides which persisted row may hydrate the bucket.
 */
export interface SidebarTopicListQuery {
  excludeStatuses?: string[];
  excludeTriggers?: string[];
  onlyMine?: boolean;
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
  onlyMine,
  showSubSessionTopics,
  topicGroupMode,
}: {
  includeCompleted: boolean;
  isGroupSession: boolean;
  onlyMine: boolean;
  /**
   * List the agent's sub-sessions (`sub_session`) as its own rows: when it asks
   * to show the ones others opened for it, and whenever Better Coding
   * Experience is off — there is no hierarchy then to show them under their
   * opener. See {@link resolveShowSubSessionTopics}.
   */
  showSubSessionTopics?: boolean;
  topicGroupMode: TopicGroupMode;
}): SidebarTopicListQuery => ({
  excludeStatuses: includeCompleted ? undefined : EXCLUDE_STATUSES_COMPLETED,
  // A group's list never holds sub-sessions (they belong to agents), so it keeps
  // the list it always asked for.
  excludeTriggers:
    showSubSessionTopics || isGroupSession
      ? MAIN_SIDEBAR_EXCLUDE_TRIGGERS_WITH_OPENED_FOR_ME
      : MAIN_SIDEBAR_EXCLUDE_TRIGGERS,
  onlyMine: onlyMine || undefined,
  sortBy: !isGroupSession && topicGroupMode === 'byStatus' ? 'status' : undefined,
});

/** Whether an agent's list shows its sub-sessions as its own rows; see `showSubSessionTopics`. */
export const resolveShowSubSessionTopics = (labEnabled: boolean, showOpenedForMe: boolean) =>
  !labEnabled || showOpenedForMe;

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
  const userState = useUserStore.getState();
  const globalState = useGlobalStore.getState();

  return normalizeTopicListParams({
    ...deriveSidebarTopicListQuery({
      includeCompleted: preferenceSelectors.topicIncludeCompleted(userState),
      isGroupSession: !!groupId,
      onlyMine:
        !!getActiveWorkspaceId() &&
        systemStatusSelectors.topicOnlyMine(groupId ?? agentId)(globalState),
      showSubSessionTopics: resolveShowSubSessionTopics(
        labPreferSelectors.enableBetterCodingExperience(userState),
        systemStatusSelectors.topicShowOpenedForMe(agentId)(globalState),
      ),
      topicGroupMode: getTopicGroupModeForAgent(agentId),
    }),
    agentId,
    groupId,
    isInbox: !groupId && !!inboxAgentId && inboxAgentId === agentId,
    pageSize: systemStatusSelectors.topicPageSize(globalState),
  });
};

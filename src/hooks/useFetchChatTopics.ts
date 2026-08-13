import { MAIN_SIDEBAR_EXCLUDE_TRIGGERS } from '@/const/topic';
import { useAgentTopicGroupMode } from '@/features/AgentSidebar/Topic/hooks/useAgentTopicGroupMode';
import { useFetchTopics } from '@/hooks/useFetchTopics';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

const EXCLUDE_STATUSES_COMPLETED = ['completed'];

/**
 * Canonical topic fetch for chat sidebars (agent + group). Reads every
 * filter from a single source so all call sites in the same route mount
 * the same SWR key and Projection index signature. This prevents sibling
 * requests with different filters from competing for one visible sidebar
 * membership set, which previously leaked completed topics into the list.
 *
 * Extend this hook when adding more preference-driven topic params; don't
 * spread them across individual components.
 */
export const useFetchChatTopics = () => {
  const includeCompleted = useUserStore(preferenceSelectors.topicIncludeCompleted);
  const activeGroupId = useChatStore((s) => s.activeGroupId);
  const { topicGroupMode } = useAgentTopicGroupMode();

  // "Group by status" ordering is resolved server-side so the highest-priority
  // topics (awaiting human → running → active) stay on the first page even when
  // the list is paginated — client-side grouping over a partial page is exactly
  // what made the previous approach flaky. Only the agent sidebar supports it;
  // group sessions keep the default updatedAt ordering.
  const sortBy = !activeGroupId && topicGroupMode === 'byStatus' ? 'status' : undefined;

  return useFetchTopics({
    excludeStatuses: includeCompleted ? undefined : EXCLUDE_STATUSES_COMPLETED,
    excludeTriggers: MAIN_SIDEBAR_EXCLUDE_TRIGGERS,
    sortBy,
  });
};

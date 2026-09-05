import type { TopicQuerySortBy } from '@lobechat/types';

import { MAIN_SIDEBAR_EXCLUDE_TRIGGERS } from '@/const/topic';
import { useAgentTopicGroupMode } from '@/features/AgentSidebar/Topic/hooks/useAgentTopicGroupMode';
import { useFetchTopics } from '@/hooks/useFetchTopics';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

const EXCLUDE_STATUSES_COMPLETED = ['completed'];

/**
 * The one query shape a `topicDataMap` bucket is allowed to hold. The bucket is
 * keyed by container (`agent_<id>`) only — not by filters — so every fetch that
 * targets a container overwrites whatever the previous one put there. Two
 * mounted fetches with different filters therefore fight, and the looser one
 * wins whenever it lands last.
 *
 * Keep all filter derivation here so no call site can drift: same args means
 * the same SWR key, which means SWR dedupes them into a single request.
 */
const useChatTopicListQuery = () => {
  const includeCompleted = useUserStore(preferenceSelectors.topicIncludeCompleted);
  const activeGroupId = useChatStore((s) => s.activeGroupId);
  const { topicGroupMode } = useAgentTopicGroupMode();

  // "Group by status" ordering is resolved server-side so the highest-priority
  // topics (awaiting human → running → active) stay on the first page even when
  // the list is paginated — client-side grouping over a partial page is exactly
  // what made the previous approach flaky. Only the agent sidebar supports it;
  // group sessions keep the default updatedAt ordering.
  const sortBy: TopicQuerySortBy | undefined =
    !activeGroupId && topicGroupMode === 'byStatus' ? 'status' : undefined;

  return {
    excludeStatuses: includeCompleted ? undefined : EXCLUDE_STATUSES_COMPLETED,
    excludeTriggers: MAIN_SIDEBAR_EXCLUDE_TRIGGERS,
    sortBy,
  };
};

/**
 * Canonical topic fetch for chat sidebars (agent + group), driven by the active
 * session. Use {@link useFetchAgentChatTopics} for a panel that names its agent
 * explicitly.
 *
 * Extend {@link useChatTopicListQuery} when adding more preference-driven topic
 * params; don't spread them across individual components.
 */
export const useFetchChatTopics = () => useFetchTopics(useChatTopicListQuery());

/**
 * Same canonical list, for the secondary conversation panels that carry their
 * own topic picker (goal chat, task manager, page copilot, agent builder).
 *
 * These share `topicDataMap[agent_<id>]` with the sidebar, so they must ask for
 * exactly the same list: fetching unfiltered here used to overwrite the
 * sidebar's bucket with system-owned topics (task runs, cron, docs, evals) the
 * moment such a panel mounted next to it.
 */
export const useFetchAgentChatTopics = (agentId?: string) => {
  const query = useChatTopicListQuery();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const pageSize = useGlobalStore(systemStatusSelectors.topicPageSize);

  return useChatStore((s) => s.useFetchTopics)(!!agentId, {
    agentId,
    ...query,
    isInbox: !!inboxAgentId && agentId === inboxAgentId,
    pageSize,
  });
};

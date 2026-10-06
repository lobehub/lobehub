import { useAgentTopicGroupMode } from '@/features/AgentSidebar/Topic/hooks/useAgentTopicGroupMode';
import {
  deriveSidebarTopicListQuery,
  type SidebarTopicListQuery,
} from '@/hooks/chatTopicListQuery';
import { useFetchTopics } from '@/hooks/useFetchTopics';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

/**
 * The one query shape a `topicDataMap` bucket is allowed to hold. The bucket is
 * keyed by container (`agent_<id>`) only — not by filters — so every fetch that
 * targets a container overwrites whatever the previous one put there. Two
 * mounted fetches with different filters therefore fight, and the looser one
 * wins whenever it lands last.
 *
 * The derivation itself lives in {@link deriveSidebarTopicListQuery}, which the
 * pre-paint hydrate reads imperatively: same inputs means the same SWR key and
 * the same persisted row, so SWR dedupes and the hydrate actually applies.
 */
const useChatTopicListQuery = (): SidebarTopicListQuery => {
  const includeCompleted = useUserStore(preferenceSelectors.topicIncludeCompleted);
  const activeGroupId = useChatStore((s) => s.activeGroupId);
  const { topicGroupMode } = useAgentTopicGroupMode();

  return deriveSidebarTopicListQuery({
    includeCompleted,
    isGroupSession: !!activeGroupId,
    topicGroupMode,
  });
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

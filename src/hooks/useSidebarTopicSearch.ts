import { useTopicOnlyMine } from '@/hooks/useTopicOnlyMine';
import { useChatStore } from '@/store/chat';

/**
 * Server-side topic search for the active agent's sidebar surfaces (topic
 * drawers, mobile search). Applies the same workspace "only mine" filter as
 * the list, so a search never brings back topics the list is hiding. An empty
 * keyword disables the request.
 */
export const useSidebarTopicSearch = (keywords: string | undefined) => {
  const [activeAgentId, useSearchTopics] = useChatStore((s) => [
    s.activeAgentId,
    s.useSearchTopics,
  ]);
  const onlyMine = useTopicOnlyMine();

  return useSearchTopics(keywords, { agentId: activeAgentId, onlyMine });
};

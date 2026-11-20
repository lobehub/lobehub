import { useDebounce } from 'ahooks';
import useSWRInfinite from 'swr/infinite';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useClientDataSWR } from '@/libs/swr';
import { topicService } from '@/services/topic';

export const WEBHOOK_TOPIC_PAGE_SIZE = 20;
const LIST_KEY = 'agent-webhook-topics';
const SEARCH_KEY = 'agent-webhook-topic-search';

export interface WebhookTopicOption {
  id: string;
  title: string | null;
  updatedAt?: Date | number | string | null;
}

/**
 * The topics a `reuse` webhook can continue: the caller's own topics of this agent (runs go out
 * as the webhook's creator). Without a keyword they load a page at a time as the list scrolls;
 * with one, the server's topic search answers instead, a moment after typing stops.
 */
export const useWebhookTopics = (agentId: string, keyword: string, enabled: boolean) => {
  const workspaceId = useActiveWorkspaceId();
  const query = useDebounce(keyword.trim(), { wait: 300 });
  const searching = query.length > 0;

  const pages = useSWRInfinite(
    (index: number, previous: WebhookTopicOption[] | null) => {
      if (!enabled || searching) return null;
      if (previous && previous.length < WEBHOOK_TOPIC_PAGE_SIZE) return null;
      return [LIST_KEY, workspaceId, agentId, index] as const;
    },
    async ([, , targetAgentId, index]: readonly [string, string | null, string, number]) =>
      (
        await topicService.getTopics({
          agentId: targetAgentId,
          current: index,
          onlyMine: true,
          pageSize: WEBHOOK_TOPIC_PAGE_SIZE,
        })
      ).items as WebhookTopicOption[],
    { revalidateFirstPage: false, revalidateOnFocus: false },
  );

  const search = useClientDataSWR<WebhookTopicOption[]>(
    enabled && searching ? [SEARCH_KEY, agentId, query] : null,
    async () =>
      (await topicService.searchTopics(query, agentId, undefined, true)) as WebhookTopicOption[],
    { revalidateOnFocus: false },
  );

  const loaded = pages.data?.flat() ?? [];
  const lastPage = pages.data?.at(-1);
  const hasMore = !searching && !!lastPage && lastPage.length === WEBHOOK_TOPIC_PAGE_SIZE;
  const loadingMore =
    !searching && pages.size > 0 && pages.data !== undefined && pages.data.length < pages.size;

  return {
    error: searching ? search.error : pages.error,
    hasMore,
    loading: searching ? search.isLoading : pages.isLoading,
    loadMore: () => {
      if (hasMore && !loadingMore) void pages.setSize(pages.size + 1);
    },
    loadingMore,
    topics: searching ? (search.data ?? []) : loaded,
  };
};

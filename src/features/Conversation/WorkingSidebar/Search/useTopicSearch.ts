import type { TopicMessageSearchMatch } from '@lobechat/types';

import { useClientDataSWR } from '@/libs/swr';
import { messageService } from '@/services/message';

const NO_MATCHES: TopicMessageSearchMatch[] = [];

interface TopicSearchResult {
  /** The keyword these matches answer; SWR may hand back an older keyword's result. */
  keyword: string;
  matches: TopicMessageSearchMatch[];
}

export interface TopicSearchView {
  /** The search for the current keyword failed and no result answers it. */
  failed: boolean;
  /** A request for the current keyword is in flight. */
  isSearching: boolean;
  /** Matches to list: the current keyword's, or the previous ones while a new search loads. */
  matches: TopicMessageSearchMatch[];
}

/**
 * What the pane shows for `query`. A result kept from an earlier keyword only
 * bridges the wait for the new one: once the new search fails it is dropped,
 * so old matches never pose as answers to the keyword that errored.
 */
export const selectTopicSearchView = ({
  data,
  error,
  query,
}: {
  data?: TopicSearchResult;
  error?: unknown;
  query: string;
}): TopicSearchView => {
  if (!query) return { failed: false, isSearching: false, matches: NO_MATCHES };

  const current = data?.keyword === query ? data.matches : undefined;
  if (current) return { failed: false, isSearching: false, matches: current };
  if (error) return { failed: true, isSearching: false, matches: NO_MATCHES };

  return { failed: false, isSearching: true, matches: data?.matches ?? NO_MATCHES };
};

/** Every message of `topicId` containing `keyword`, read from the server's full history. */
export const useTopicSearch = (topicId: string | undefined, keyword: string) => {
  const query = keyword.trim();
  const { data, error, mutate } = useClientDataSWR<TopicSearchResult>(
    topicId && query ? ['topicMessageSearch', topicId, query] : null,
    async ([, id, text]: [string, string, string]) => ({
      keyword: text,
      matches: await messageService.searchInTopic({ keyword: text, topicId: id }),
    }),
    { keepPreviousData: true, revalidateOnFocus: false },
  );

  return { ...selectTopicSearchView({ data, error, query }), retry: () => mutate() };
};

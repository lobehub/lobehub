import { useDebounce } from 'ahooks';

import { useClientDataSWR } from '@/libs/swr';
import { fileService } from '@/services/file';
import { topicService } from '@/services/topic';

// A failed read stays distinct from an empty list, with a retry, so a network blip never reads
// as "you have no documents".
export const useRecentPages = (enabled: boolean) => {
  const { data, error, mutate } = useClientDataSWR(
    enabled ? ['memoryRules', 'distill', 'recentPages'] : null,
    async () => {
      const items = await fileService.getRecentPages(30);
      return items.map(({ id, name, updatedAt }) => ({ id, name, updatedAt }));
    },
    { revalidateOnFocus: false },
  );
  return { error: !!error && !data, items: data, retry: () => mutate() };
};

export const useTopics = (enabled: boolean, keywords: string) => {
  const query = useDebounce(keywords.trim(), { wait: 300 });
  const { data, error, mutate } = useClientDataSWR(
    enabled ? ['memoryRules', 'distill', 'topics', query] : null,
    async (): Promise<{ agent?: string; id: string; title: string }[]> => {
      if (query) {
        const items = await topicService.searchTopics(query);
        return items.map(({ id, title }) => ({ id, title: title ?? '' }));
      }
      const items = await topicService.getRecentTopics(30);
      return items.map(({ agent, id, title }) => ({
        agent: agent?.title ?? undefined,
        id,
        title: title ?? '',
      }));
    },
    { keepPreviousData: true, revalidateOnFocus: false },
  );
  return { error: !!error && !data, items: data, retry: () => mutate() };
};

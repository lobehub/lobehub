import { useAvailableSearchChannels, useSearchChannelStore } from '@/store/searchChannel';

/**
 * Search providers and crawlers the server enables, from a replica: a reload
 * paints the persisted list while the server confirms it, and a failed refresh
 * keeps it on screen (only a first load surfaces the error).
 */
export const useAvailableChannels = () => {
  const { error, revalidate } = useSearchChannelStore((s) => s.useFetchAvailableChannels)();
  const data = useAvailableSearchChannels();

  return {
    data,
    error: data ? undefined : error,
    isLoading: !data && !error,
    retry: revalidate,
  };
};

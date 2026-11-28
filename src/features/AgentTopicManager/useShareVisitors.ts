import { useClientDataSWR } from '@/libs/swr';
import { channelService } from '@/services/channel';
import { CHANNEL_IDLE_REFRESH_MS } from '@/store/channel/action';

/**
 * Visitors' conversations with the Agent's share, read only while the 「Share」 source is picked.
 * Empty unless the share lets its owner read visitor conversations. Visitors keep talking and runs
 * settle without notifying the creator, so the list refreshes like the idle Channel list.
 */
export const useShareVisitors = (agentId: string | undefined, enabled: boolean) => {
  const { data, error, isLoading, mutate } = useClientDataSWR(
    enabled && agentId ? ['agentTopicManager', 'shareVisitors', agentId] : null,
    () => channelService.shareVisitors(agentId!),
    { refreshInterval: CHANNEL_IDLE_REFRESH_MS },
  );
  return {
    conversations: enabled ? (data ?? []) : [],
    error: enabled && !data ? error : undefined,
    loading: enabled && isLoading,
    retry: () => void mutate(),
  };
};

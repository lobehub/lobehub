import type { ShareVisitorTopicGroup } from '@lobechat/types';

import { useChannelsEnabled } from '@/features/Channels/useChannelsEnabled';
import { useClientDataSWR } from '@/libs/swr';
import { channelService } from '@/services/channel';
import { CHANNEL_IDLE_REFRESH_MS } from '@/store/channel/action';

const EMPTY: ShareVisitorTopicGroup[] = [];

/**
 * Visitors' run topics with the Agent's share, by visitor. Empty unless the share lets its owner
 * read visitor conversations. Visitors keep talking without notifying the owner, so the list
 * refreshes like the idle Channel list.
 */
export const useShareVisitorTopics = (agentId: string | undefined) => {
  const enabled = useChannelsEnabled();
  const { data } = useClientDataSWR(
    enabled && agentId ? ['shareVisitorTopics', agentId] : null,
    () => channelService.shareVisitorTopics(agentId!),
    // Most Agents are never shared: read once on open, and keep polling only while there are
    // visitors to follow.
    { refreshInterval: (latest) => (latest?.length ? CHANNEL_IDLE_REFRESH_MS : 0) },
  );
  return data ?? EMPTY;
};

/** A visitor's run topic with its transcript. A visitor may still be talking, so it refreshes. */
export const useShareVisitorTopic = (topicId: string | undefined) =>
  useClientDataSWR(
    topicId ? ['shareVisitorTopic', topicId] : null,
    () => channelService.shareVisitorTopic(topicId!),
    { refreshInterval: CHANNEL_IDLE_REFRESH_MS },
  );

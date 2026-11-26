import type { ShareVisitorTopicGroup } from '@lobechat/types';

import { useChannelsEnabled } from '@/features/Channels/useChannelsEnabled';
import { useClientDataSWR } from '@/libs/swr';
import { channelService } from '@/services/channel';
import { CHANNEL_IDLE_REFRESH_MS } from '@/store/channel/action';

const EMPTY: ShareVisitorTopicGroup[] = [];

/**
 * Visitors' run topics with the Agent's share, by visitor, with the first read's loading state.
 * Empty unless the share lets its owner read visitor conversations. Visitors keep talking without
 * notifying the owner, so the list refreshes like the idle Channel list. `mutate` re-reads it, e.g.
 * right after the owner allows reading visitor conversations. `enabled` is false while Channels are
 * off for the user (or their flags have not loaded): the list is then unknown, not empty. A failed
 * read keeps `groups` empty too, so check `error` before calling the list empty.
 */
export const useShareVisitorTopicGroups = (agentId: string | undefined) => {
  const enabled = useChannelsEnabled();
  const { data, error, isLoading, mutate } = useClientDataSWR(
    enabled && agentId ? ['shareVisitorTopics', agentId] : null,
    () => channelService.shareVisitorTopics(agentId!),
    // Most Agents are never shared: read once on open, and keep polling only while there are
    // visitors to follow.
    { refreshInterval: (latest) => (latest?.length ? CHANNEL_IDLE_REFRESH_MS : 0) },
  );
  return { enabled, error, groups: data ?? EMPTY, isLoading, mutate };
};

/** Visitors' run topics with the Agent's share, by visitor. */
export const useShareVisitorTopics = (agentId: string | undefined) =>
  useShareVisitorTopicGroups(agentId).groups;

/** A visitor's run topic with its transcript. A visitor may still be talking, so it refreshes. */
export const useShareVisitorTopic = (topicId: string | undefined) =>
  useClientDataSWR(
    topicId ? ['shareVisitorTopic', topicId] : null,
    () => channelService.shareVisitorTopic(topicId!),
    { refreshInterval: CHANNEL_IDLE_REFRESH_MS },
  );

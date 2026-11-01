import type { ChannelDetail, ChannelListItem } from '@lobechat/types';

import { defineReplica, type ReplicaEntityAdapter } from '@/libs/replica';
import { channelService, type ChannelViewParams } from '@/services/channel';

export const channelThreadEntityId = (channelId: string, threadId: string) =>
  `${channelId}/thread/${threadId}`;

/** A branch appears in every view's thread list and owns views with its root message. */
export const channelDetailEntity: ReplicaEntityAdapter<ChannelDetail, { id: string }> = {
  has: (data, id) =>
    data.channel.id === id ||
    data.threads.some((thread) => channelThreadEntityId(data.channel.id, thread.id) === id),
  map: (data, id, fn) => {
    if (data.channel.id === id) {
      const next = fn(data.channel);
      return next ? { ...data, channel: { ...data.channel, ...next } } : undefined;
    }
    const thread = data.threads.find(
      (entry) => channelThreadEntityId(data.channel.id, entry.id) === id,
    );
    if (!thread) return data;
    const next = fn(thread);
    if (!next && data.rootMessage?.id === thread.rootMessageId) return undefined;
    return {
      ...data,
      threads: data.threads.flatMap((entry) =>
        entry.id !== thread.id ? [entry] : next ? [{ ...entry, ...next }] : [],
      ),
    };
  },
};

export const channelViewKey = (params: ChannelViewParams) =>
  `${params.channelId}:${params.threadId ?? 'main'}:${params.before ?? 'latest'}`;

export const channelListResource = defineReplica<Record<string, never>, ChannelListItem[]>({
  fetcher: () => channelService.list(),
  key: () => 'all',
  name: 'channelList',
  storage: 'indexedDB',
  version: 1,
});

export const channelDetailResource = defineReplica<ChannelViewParams, ChannelDetail>({
  fetcher: channelService.detail,
  key: channelViewKey,
  name: 'channelDetail',
  storage: 'indexedDB',
  version: 1,
});

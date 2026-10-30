import type { ChannelDetail, ChannelListItem } from '@lobechat/types';

import {
  arrayEntity,
  cacheScope,
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
} from '@/libs/replica';
import { channelService, type ChannelViewParams } from '@/services/channel';
import type { StoreSetter } from '@/store/types';
import { isTrpcErrorCode } from '@/utils/trpcError';

import { retireChannelAgent } from './agentDeletion';
import {
  channelDetailEntity,
  channelDetailResource,
  channelListResource,
  channelThreadEntityId,
} from './projection';
import type { ChannelState } from './store';

export class ChannelPrivateAction {
  // First loads have no replica entry yet. Keep only their request parameters so a
  // confirmed deletion can ask the replica to supersede those responses as well.
  private readonly pendingViews = new Set<{ params: ChannelViewParams; scope: string }>();
  // Scope → thread ID → entity ID. A pre-delete head response may arrive after
  // persistence has settled; unlike hydration, it would lift replica entity guards.
  // Only a recycle-bin restore, which keeps the thread ID, lifts the marker.
  private readonly deletedThreads = new Map<string, Map<string, string>>();
  resetThreadRemovals = () => this.deletedThreads.clear();
  forgetThreadRemovals = (threadIds: Iterable<string>) => {
    for (const threadId of threadIds)
      for (const ids of this.deletedThreads.values()) ids.delete(threadId);
  };
  removeThread = (channelId: string, threadId: string, scope: string) => {
    const id = channelThreadEntityId(channelId, threadId);
    const ids = this.deletedThreads.get(scope) ?? new Map<string, string>();
    ids.set(threadId, id);
    this.deletedThreads.set(scope, ids);
    this.detail.removeEntity(id, { scope });
  };
  readonly detail;
  readonly entity;
  readonly list;
  retireAgent = async (agentId: string) => {
    const scope = cacheScope.get();
    const state = this.get();
    const refreshes = new Map(
      [...this.pendingViews]
        .filter((request) => request.scope === scope)
        // The same page can have different request identities (omitted vs null
        // threadId). Supersede every parameter shape, not just the page key.
        .map(({ params }) => [JSON.stringify(params), params]),
    );
    for (const [key, view] of Object.entries(state.detailMap)) {
      if (!view.members.some((member) => member.agentId === agentId)) continue;
      this.detail.update(key, (detail) => detail && retireChannelAgent(detail, agentId));
      // The bound resource owns these params. A fresh read retires pre-deletion
      // requests even for cached pages with no mounted SWR subscriber.
      const params = state.detailReplica.entries[key]?.params as ChannelViewParams | undefined;
      if (params) refreshes.set(JSON.stringify(params), params);
    }
    await Promise.all(
      [...refreshes.values()].map((params) => this.detail.fetch(params, { fresh: true, scope })),
    );
  };
  private readonly get;
  constructor(set: StoreSetter<ChannelState>, get: () => ChannelState) {
    this.get = get;
    this.list = createReplicaSlice(channelListResource, {
      actionPrefix: 'channel/list',
      entity: arrayEntity<ChannelListItem>((channel) => channel.id),
      get,
      set,
      stateKey: 'listReplica',
      view: recordLens<ChannelState, ChannelListItem[]>('listMap'),
    });
    this.detail = createReplicaSlice(channelDetailResource, {
      actionPrefix: 'channel/detail',
      fetcher: async (params) => {
        const request = { params, scope: cacheScope.get() };
        this.pendingViews.add(request);
        try {
          return await channelService.detail(params);
        } finally {
          this.pendingViews.delete(request);
        }
      },
      effects: {
        onError: (error, params, { scope }) => {
          if (params.threadId && isTrpcErrorCode(error, 'NOT_FOUND')) {
            this.removeThread(params.channelId, params.threadId, scope);
            return;
          }
          if (
            isTrpcErrorCode(error, 'NOT_FOUND') ||
            isTrpcErrorCode(error, 'FORBIDDEN') ||
            isTrpcErrorCode(error, 'UNAUTHORIZED')
          )
            this.entity.remove(params.channelId, { scope });
        },
      },
      entity: channelDetailEntity,
      prepareHead: (incoming) => {
        let data: ChannelDetail | undefined = incoming;
        for (const id of this.deletedThreads.get(cacheScope.get())?.values() ?? []) {
          if (!data) break;
          data = channelDetailEntity.map(data, id, () => undefined);
        }
        return data;
      },
      get,
      set,
      stateKey: 'detailReplica',
      view: recordLens<ChannelState, ChannelDetail>('detailMap'),
    });
    this.entity = linkReplicaEntity<ChannelListItem>([this.list, this.detail]);
  }
}

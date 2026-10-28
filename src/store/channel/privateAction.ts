import type { ChannelDetail, ChannelListItem } from '@lobechat/types';

import {
  arrayEntity,
  cacheScope,
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
} from '@/libs/replica';
import type { StoreSetter } from '@/store/types';
import { isTrpcErrorCode } from '@/utils/trpcError';

import {
  channelDetailEntity,
  channelDetailResource,
  channelListResource,
  channelThreadEntityId,
} from './projection';
import type { ChannelState } from './store';

export class ChannelPrivateAction {
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
  constructor(set: StoreSetter<ChannelState>, get: () => ChannelState) {
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

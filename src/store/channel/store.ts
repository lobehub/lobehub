import type { ChannelDetail, ChannelListItem } from '@lobechat/types';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createReplicaState, type ReplicaState } from '@/libs/replica';
import { createDevtools } from '@/store/middleware/createDevtools';

import type { ChannelOutbox } from './outbox';

export interface ChannelState {
  detailMap: Record<string, ChannelDetail>;
  detailReplica: ReplicaState<ChannelDetail>;
  listMap: Record<string, ChannelListItem[]>;
  listReplica: ReplicaState<ChannelListItem[]>;
  /** Messages sent from this tab, by conversation, until a loaded page holds them. */
  outbox: ChannelOutbox;
}

export const initialState: ChannelState = {
  detailMap: {},
  detailReplica: createReplicaState(),
  listMap: {},
  listReplica: createReplicaState(),
  outbox: {},
};

export const useChannelStore = createWithEqualityFn<ChannelState>()(
  createDevtools('channel')(() => initialState),
  shallow,
);

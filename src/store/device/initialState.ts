import type { DeviceListItem } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

export interface DeviceState {
  /**
   * `deviceListMap.all`: every device of the active scope, or `undefined` until
   * the persisted copy or the server answers. Read it through `deviceSelectors`.
   */
  deviceListMap: Record<string, DeviceListItem[]>;
  /** Replica bookkeeping for `deviceListMap`. */
  deviceListReplica: ReplicaState<DeviceListItem[]>;
}

export const initialState: DeviceState = {
  deviceListMap: {},
  deviceListReplica: createReplicaState(),
};

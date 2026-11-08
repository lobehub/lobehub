import type { DeviceListItem, DeviceMetricSeries } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

export interface DeviceState {
  /**
   * `deviceListMap.all`: every device of the active scope, or `undefined` until
   * the persisted copy or the server answers. Read it through `deviceSelectors`.
   */
  deviceListMap: Record<string, DeviceListItem[]>;
  /** Replica bookkeeping for `deviceListMap`. */
  deviceListReplica: ReplicaState<DeviceListItem[]>;
  /** Health series per `deviceMetricSeriesKey`; read it through `deviceSelectors.getMetricSeries`. */
  deviceMetricSeriesMap: Record<string, DeviceMetricSeries>;
  /** Replica bookkeeping for `deviceMetricSeriesMap`. */
  deviceMetricSeriesReplica: ReplicaState<DeviceMetricSeries>;
}

export const initialState: DeviceState = {
  deviceListMap: {},
  deviceListReplica: createReplicaState(),
  deviceMetricSeriesMap: {},
  deviceMetricSeriesReplica: createReplicaState(),
};

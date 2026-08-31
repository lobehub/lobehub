import type { RecentItem } from '@lobechat/types';

import {
  LocalStorageQueryProjectionStorage,
  type QueryProjection,
} from '@/libs/queryProjectionStorage';

const deserialize = (value: string): QueryProjection<RecentItem[]> => {
  const projection = JSON.parse(value) as QueryProjection<RecentItem[]>;

  return {
    ...projection,
    data: projection.data.map((item) => ({ ...item, updatedAt: new Date(item.updatedAt) })),
  };
};

export const recentProjectionStorage = new LocalStorageQueryProjectionStorage<RecentItem[]>({
  deserialize,
  namespace: 'lobechat-home-recents-v2',
});
